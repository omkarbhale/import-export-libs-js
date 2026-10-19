import { ENGINES, ENGINE_ASSEMBLY_VERSIONS, type Engine } from "../engines.js";
import { CItemException } from "./fault.js";

/**
 * A server or engine version. Like the engine's type it has no text form of its
 * own, so WIRE-024 writes the type name where a version is meant.
 *
 * @spec WIRE-021 WIRE-022
 */
export class ArasVersion {
  /** What .NET prints for the type, which is all the engine's refusal message shows of a version. */
  static readonly TYPE_NAME = "Aras.Tools.SolutionUpgrade.ArasVersion";

  constructor(
    readonly major: number,
    readonly minor: number,
    readonly servicePack: number,
    readonly build: number,
    readonly serviceUpdate: number,
  ) {}

  /** `12.0 SP9 Build 24090` below major version 14, `14.0.7.35492`-style from 14 on. */
  get fullString(): string {
    return this.major < 14
      ? `${this.major}.${this.minor} SP${this.servicePack} Build ${this.build}`
      : `${this.major}.${this.minor}.${this.serviceUpdate}.${this.build}`;
  }
}

/**
 * The engine's own version for the gate: the major and minor of its assembly.
 *
 * @spec WIRE-022 WIRE-023
 */
export function currentUtilityVersion(engine: Engine): ArasVersion {
  const [major = "0", minor = "0"] = ENGINE_ASSEMBLY_VERSIONS[engine].split(".");
  return new ArasVersion(Number(major), Number(minor), 0, 0, 0);
}

/** True when `engine`'s gate lets a server of this major version through: not above the engine's, and at most 2 below. */
export function engineAcceptsServer(engine: Engine, serverMajor: number): boolean {
  const utilityMajor = currentUtilityVersion(engine).major;
  return serverMajor <= utilityMajor && utilityMajor - serverMajor <= 2;
}

/** The engines whose gate accepts a server of this major version, in `ENGINES` order. */
export function enginesAcceptingServer(serverMajor: number): Engine[] {
  return ENGINES.filter((engine) => engineAcceptsServer(engine, serverMajor));
}

/**
 * The engine's version refusal, with the engines that would accept the server.
 * It is the engine's own `CItemException` (WIRE-024), so its code, text and
 * message are the engine's; `hint` is the library's addition.
 *
 * `[14.0.7]` names the type of both versions, which have no text form; `[14.35]` writes both as WIRE-022's text.
 *
 * @spec WIRE-023 WIRE-024
 */
export class VersionRefusal extends CItemException {
  readonly fittingEngines: Engine[];
  readonly hint: string;

  constructor(
    readonly engine: Engine,
    readonly serverVersion: ArasVersion,
  ) {
    const [utility, server] =
      engine === "14.35"
        ? [currentUtilityVersion(engine).fullString, serverVersion.fullString]
        : [ArasVersion.TYPE_NAME, ArasVersion.TYPE_NAME];
    super(0, `You are trying to use incompatible utility of version ${utility} with innovator version ${server}.`, null);
    this.name = "VersionRefusal";
    this.fittingEngines = enginesAcceptingServer(serverVersion.major);
    const major = `${serverVersion.major}.${serverVersion.minor}`;
    this.hint =
      this.fittingEngines.length > 0
        ? `Engine ${engine} does not accept Aras server ${major}. Engines that accept it: ${this.fittingEngines.join(", ")}. ` +
          `Use --engine with one of them, or --skip-version-check to run ${engine} anyway.`
        : `Engine ${engine} does not accept Aras server ${major}, and no engine of this library does. ` +
          `Use --skip-version-check to run ${engine} anyway.`;
  }
}
