import { isNameChar, isNameStartChar } from "./chars.js";
import { XPathException } from "./errors.js";

/**
 * Checks an XPath 1.0 expression the way .NET's `XPathParser` does, only to reproduce its exception: which message an
 * expression that is not valid gets depends on where the parser gives up. The `xpath` package evaluates the expressions that
 * pass. The grammar and the order in which tokens are scanned and checked follow .NET, so a string literal that never
 * ends is reported only if the parser gets as far as scanning it.
 *
 * @spec MAN-014
 */

type Kind =
  | "eof" | "comma" | "slash" | "slashslash" | "at" | "dot" | "dotdot" | "lparen" | "rparen" | "lbracket" | "rbracket"
  | "star" | "plus" | "minus" | "eq" | "ne" | "lt" | "gt" | "le" | "ge" | "union" | "dollar" | "bang" | "unknown" | "string" | "number" | "name" | "axis";

type ResultType = "nodeset" | "string" | "number" | "boolean" | "any";

const FUNCTION_TYPES: Readonly<Record<string, ResultType>> = {
  last: "number", position: "number", count: "number", id: "nodeset", "local-name": "string", "namespace-uri": "string", name: "string",
  string: "string", concat: "string", "starts-with": "boolean", contains: "boolean", "substring-before": "string", "substring-after": "string",
  substring: "string", "string-length": "number", "normalize-space": "string", translate: "string", boolean: "boolean", not: "boolean",
  true: "boolean", false: "boolean", lang: "boolean", number: "number", sum: "number", floor: "number", ceiling: "number", round: "number",
};

/** The number of arguments each core function takes: [least, most]. */
const FUNCTION_ARITY: Readonly<Record<string, readonly [number, number]>> = {
  last: [0, 0], position: [0, 0], count: [1, 1], id: [1, 1], "local-name": [0, 1], "namespace-uri": [0, 1], name: [0, 1], string: [0, 1],
  concat: [2, Infinity], "starts-with": [2, 2], contains: [2, 2], "substring-before": [2, 2], "substring-after": [2, 2], substring: [2, 3],
  "string-length": [0, 1], "normalize-space": [0, 1], translate: [3, 3], boolean: [1, 1], not: [1, 1], true: [0, 0], false: [0, 0], lang: [1, 1],
  number: [0, 1], sum: [1, 1], floor: [1, 1], ceiling: [1, 1], round: [1, 1],
};

const AXES = new Set([
  "ancestor", "ancestor-or-self", "attribute", "child", "descendant", "descendant-or-self", "following", "following-sibling", "namespace",
  "parent", "preceding", "preceding-sibling", "self",
]);

const NODE_TYPES = new Set(["node", "text", "comment", "processing-instruction"]);

class Parser {
  private index = 0;
  private kind: Kind = "eof";
  private name = "";
  private prefix = "";
  private canBeFunction = false;
  /** Prefixes used in name tests and whether a variable was named: what .NET reports when it compiles the expression. */
  private readonly prefixes: string[] = [];
  private usesVariable = false;
  private unknownFunction = false;

  constructor(private readonly source: string) {
    this.nextLex();
  }

  private invalidToken(): never {
    throw new XPathException(`'${this.source}' has an invalid token.`);
  }

  private nodeSetExpected(): never {
    throw new XPathException("Expression must evaluate to a node-set.");
  }

  // ---------------------------------------------------------------- scanner

  private char(offset = 0): string {
    return this.source.charAt(this.index + offset);
  }

  private skipSpace(): void {
    while (" \t\r\n".includes(this.char()) && this.index < this.source.length) this.index += 1;
  }

  private scanName(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length && isNameChar(this.char())) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private nextLex(): void {
    this.skipSpace();
    this.name = "";
    this.prefix = "";
    this.canBeFunction = false;
    if (this.index >= this.source.length) {
      this.kind = "eof";
      return;
    }
    const ch = this.char();
    const simple: Record<string, Kind> = {
      ",": "comma", "@": "at", "(": "lparen", ")": "rparen", "[": "lbracket", "]": "rbracket", "*": "star", "+": "plus", "-": "minus", "=": "eq",
      "|": "union", $: "dollar",
    };
    const one = simple[ch];
    if (one !== undefined) {
      this.index += 1;
      this.kind = one;
    } else if (ch === "/") {
      this.index += 1;
      if (this.char() === "/") {
        this.index += 1;
        this.kind = "slashslash";
      } else this.kind = "slash";
    } else if (ch === "!") {
      const notEqual = this.char(1) === "=";
      this.index += notEqual ? 2 : 1;
      this.kind = notEqual ? "ne" : "bang";
    } else if (ch === "<" || ch === ">") {
      this.index += 1;
      const orEqual = this.char() === "=";
      if (orEqual) this.index += 1;
      this.kind = ch === "<" ? (orEqual ? "le" : "lt") : orEqual ? "ge" : "gt";
    } else if (ch === ".") {
      if (/[0-9]/.test(this.char(1))) this.scanNumber();
      else if (this.char(1) === ".") {
        this.index += 2;
        this.kind = "dotdot";
      } else {
        this.index += 1;
        this.kind = "dot";
      }
    } else if (/[0-9]/.test(ch)) {
      this.scanNumber();
    } else if (ch === "'" || ch === '"') {
      const close = this.source.indexOf(ch, this.index + 1);
      if (close < 0) throw new XPathException("This is an unclosed string.");
      this.index = close + 1;
      this.kind = "string";
    } else if (isNameStartChar(ch)) {
      this.name = this.scanName();
      let axis = false;
      if (this.char() === ":") {
        if (this.char(1) === ":") {
          this.index += 2;
          axis = true;
        } else {
          this.index += 1;
          this.prefix = this.name;
          if (this.char() === "*") {
            this.index += 1;
            this.name = "*";
          } else if (isNameStartChar(this.char())) {
            this.name = this.scanName();
          } else {
            throw new XPathException(`'${this.source}' has an invalid qualified name.`);
          }
        }
      }
      this.skipSpace();
      this.canBeFunction = this.char() === "(";
      this.kind = axis ? "axis" : "name";
      if (axis) this.skipSpace();
    } else if (ch === ":") {
      this.invalidToken();
    } else {
      this.index += 1;
      this.kind = "unknown";
    }
  }

  private scanNumber(): void {
    while (/[0-9]/.test(this.char())) this.index += 1;
    if (this.char() === ".") {
      this.index += 1;
      while (/[0-9]/.test(this.char())) this.index += 1;
    }
    this.kind = "number";
  }

  private passToken(kind: Kind): void {
    if (this.kind !== kind) this.invalidToken();
    this.nextLex();
  }

  private isOperatorName(operator: string): boolean {
    return this.kind === "name" && this.prefix === "" && this.name === operator;
  }

  // ---------------------------------------------------------------- grammar

  parse(): void {
    this.parseOr();
    if (this.kind !== "eof") this.invalidToken();
    // what .NET finds when it compiles a parsed expression
    if (this.usesVariable || this.unknownFunction) throw new XPathException("XsltContext is needed for this query because of an unknown function.");
    for (const prefix of this.prefixes) {
      if (prefix !== "xml") throw new XPathException(`Namespace prefix '${prefix}' is not defined.`);
    }
  }

  private parseOr(): ResultType {
    let type = this.parseAnd();
    while (this.isOperatorName("or")) {
      this.nextLex();
      this.parseAnd();
      type = "boolean";
    }
    return type;
  }

  private parseAnd(): ResultType {
    let type = this.parseEquality();
    while (this.isOperatorName("and")) {
      this.nextLex();
      this.parseEquality();
      type = "boolean";
    }
    return type;
  }

  private parseEquality(): ResultType {
    let type = this.parseRelational();
    while (this.kind === "eq" || this.kind === "ne") {
      this.nextLex();
      this.parseRelational();
      type = "boolean";
    }
    return type;
  }

  private parseRelational(): ResultType {
    let type = this.parseAdditive();
    while (this.kind === "lt" || this.kind === "gt" || this.kind === "le" || this.kind === "ge") {
      this.nextLex();
      this.parseAdditive();
      type = "boolean";
    }
    return type;
  }

  private parseAdditive(): ResultType {
    let type = this.parseMultiplicative();
    while (this.kind === "plus" || this.kind === "minus") {
      this.nextLex();
      this.parseMultiplicative();
      type = "number";
    }
    return type;
  }

  private parseMultiplicative(): ResultType {
    let type = this.parseUnary();
    while (this.kind === "star" || this.isOperatorName("div") || this.isOperatorName("mod")) {
      this.nextLex();
      this.parseUnary();
      type = "number";
    }
    return type;
  }

  private parseUnary(): ResultType {
    let negated = false;
    while (this.kind === "minus") {
      this.nextLex();
      negated = true;
    }
    const type = this.parseUnion();
    return negated ? "number" : type;
  }

  private parseUnion(): ResultType {
    let type = this.parsePath(null);
    while (this.kind === "union") {
      this.nextLex();
      const second = this.parsePath(null);
      if (type !== "nodeset" || second !== "nodeset") this.nodeSetExpected();
      type = "nodeset";
    }
    return type;
  }

  private startsPrimary(): boolean {
    return (
      this.kind === "dollar" || this.kind === "lparen" || this.kind === "string" || this.kind === "number" ||
      (this.kind === "name" && this.canBeFunction && !(this.prefix === "" && NODE_TYPES.has(this.name)))
    );
  }

  private startsStep(): boolean {
    return this.kind === "dot" || this.kind === "dotdot" || this.kind === "at" || this.kind === "axis" || this.kind === "star" || this.kind === "name";
  }

  private parsePath(input: ResultType | null): ResultType {
    if (this.startsPrimary()) {
      let type = this.parseFilter();
      if (this.kind === "slash" || this.kind === "slashslash") {
        this.nextLex();
        this.parseRelativePath();
        if (type !== "nodeset") this.nodeSetExpected();
        type = "nodeset";
      }
      return type;
    }
    void input;
    if (this.kind === "slash") {
      this.nextLex();
      if (this.startsStep()) this.parseRelativePath();
      return "nodeset";
    }
    if (this.kind === "slashslash") {
      this.nextLex();
      this.parseRelativePath();
      return "nodeset";
    }
    this.parseRelativePath();
    return "nodeset";
  }

  private parseRelativePath(): void {
    this.parseStep();
    while (this.kind === "slash" || this.kind === "slashslash") {
      this.nextLex();
      this.parseStep();
    }
  }

  private parseStep(): void {
    if (this.kind === "dot" || this.kind === "dotdot") {
      this.nextLex();
    } else {
      if (this.kind === "at") this.nextLex();
      else if (this.kind === "axis") {
        if (!AXES.has(this.name)) this.invalidToken();
        this.nextLex();
      }
      this.parseNodeTest();
    }
    while (this.kind === "lbracket") this.parsePredicate("nodeset");
  }

  private parseNodeTest(): void {
    if (this.kind === "star") {
      this.nextLex();
      return;
    }
    if (this.kind !== "name") this.nodeSetExpected();
    if (this.prefix !== "") this.prefixes.push(this.prefix);
    if (this.canBeFunction && this.prefix === "" && NODE_TYPES.has(this.name)) {
      const target = this.name;
      this.nextLex();
      this.passToken("lparen");
      if (target === "processing-instruction" && (this.kind as Kind) === "string") this.nextLex();
      this.passToken("rparen");
      return;
    }
    this.nextLex();
  }

  private parsePredicate(input: ResultType): void {
    if (input !== "nodeset") this.nodeSetExpected();
    this.passToken("lbracket");
    this.parseOr();
    this.passToken("rbracket");
  }

  private parseFilter(): ResultType {
    let type = this.parsePrimary();
    while (this.kind === "lbracket") {
      this.parsePredicate(type);
      type = "nodeset";
    }
    return type;
  }

  private parsePrimary(): ResultType {
    switch (this.kind) {
      case "string":
        this.nextLex();
        return "string";
      case "number":
        this.nextLex();
        return "number";
      case "dollar":
        this.nextLex();
        if ((this.kind as Kind) !== "name") this.invalidToken();
        this.usesVariable = true;
        this.nextLex();
        return "any";
      case "lparen": {
        this.nextLex();
        const type = this.parseOr();
        this.passToken("rparen");
        return type;
      }
      default: {
        const name = this.name;
        const known = this.prefix === "";
        const type = (known ? FUNCTION_TYPES[name] : undefined) ?? "any";
        this.nextLex();
        this.passToken("lparen");
        let count = 0;
        if (this.kind !== "rparen") {
          this.parseOr();
          count = 1;
          while (this.kind === "comma") {
            this.nextLex();
            this.parseOr();
            count += 1;
          }
        }
        this.passToken("rparen");
        const arity = known ? FUNCTION_ARITY[name] : undefined;
        if (arity && (count < arity[0] || count > arity[1])) {
          throw new XPathException(`Function '${name}' in '${this.source}' has an invalid number of arguments.`);
        }
        if (!known || arity === undefined) this.unknownFunction = true;
        return type;
      }
    }
  }
}

/** Throws the `XPathException` .NET throws for an expression it cannot parse. */
export function checkXPathSyntax(expression: string): void {
  new Parser(expression).parse();
}
