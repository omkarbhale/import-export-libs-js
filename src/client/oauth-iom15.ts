import { isMd5Hash, isSha256Hash, md5Digest, sha256Digest } from "./digest.js";
import { DotNetException } from "./dotnet.js";
import { OAuthServerError, type TokenAnswer, type TokenProvider, postTokenForm } from "./oauth.js";
import type { HttpTransport } from "./transport.js";

/**
 * IOM 15's `PasswordTokenProvider` (the `[14.35]` variant of the password grant). The first request carries the password as
 * given. When the server answers that it wants the other hash, the password becomes its digest, the request is sent once more
 * and the digest is kept for later requests. A token answer with a refresh token makes every later token a refresh grant.
 *
 * @spec WIRE-012 WIRE-013 WIRE-014 WIRE-018 WIRE-055
 */
export class Iom15PasswordTokenProvider implements TokenProvider {
  /** IOM's `Password` property: the password as given until a retry replaces it with a digest. */
  private password: string;
  private refreshToken: string | undefined;

  /** Throws like IOM when the database or user name is empty, or the password is null; an empty password is accepted. */
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokenEndpoint: string,
    private readonly credentials: { database: string; userName: string; password: string | null },
  ) {
    if (credentials.database === "") throw new DotNetException("System.ArgumentException", "Database");
    if (credentials.userName === "") throw new DotNetException("System.ArgumentException", "UserName");
    if (credentials.password === null) throw new DotNetException("System.ArgumentException", "Password");
    this.password = credentials.password;
  }

  /** The token, which may be empty when the server's answer had none: the caller refuses to send an empty one (WIRE-018). */
  async getAccessToken(): Promise<string> {
    if (this.refreshToken !== undefined) return this.renewByRefreshToken(this.refreshToken);
    const answer = await this.passwordGrant();
    if (answer.refreshToken !== undefined && answer.refreshToken !== "") this.refreshToken = answer.refreshToken;
    return answer.accessToken ?? "";
  }

  private sendPasswordGrant(): Promise<TokenAnswer> {
    return postTokenForm(this.transport, this.tokenEndpoint, [
      ["grant_type", "password"],
      ["client_id", "IOMApp"],
      ["scope", "Innovator"],
      ["database", this.credentials.database],
      ["username", this.credentials.userName],
      ["password", this.password],
    ]);
  }

  /** The password grant, with the one retry that WIRE-013 allows. The retry's own error is final. */
  private async passwordGrant(): Promise<TokenAnswer> {
    try {
      return await this.sendPasswordGrant();
    } catch (error) {
      if (!(error instanceof OAuthServerError)) throw error;
      const given = this.credentials.password ?? "";
      if (error.errorCode === "incompatible_hash_use_md5") {
        if (isSha256Hash(given)) throw error;
        this.password = md5Digest(given);
      } else if (error.errorCode === "incompatible_hash_use_sha256") {
        if (isMd5Hash(given)) throw error;
        this.password = sha256Digest(given);
      } else {
        throw error;
      }
      return this.sendPasswordGrant();
    }
  }

  /** IOM's `RefreshTokenProvider`: the answer must hold both tokens, and its refresh token replaces the stored one. */
  private async renewByRefreshToken(refreshToken: string): Promise<string> {
    const answer = await postTokenForm(this.transport, this.tokenEndpoint, [
      ["grant_type", "refresh_token"],
      ["client_id", "IOMApp"],
      ["refresh_token", refreshToken],
    ]);
    if (answer.refreshToken === undefined || answer.refreshToken === "") {
      throw new DotNetException("System.InvalidOperationException", "Refresh token is missing.");
    }
    if (answer.accessToken === undefined || answer.accessToken === "") {
      throw new DotNetException("System.InvalidOperationException", "Access token is missing.");
    }
    this.refreshToken = answer.refreshToken;
    return answer.accessToken;
  }
}
