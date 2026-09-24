import { ExpressionParseError } from "./errors.js";
import type { DecisionDefinition } from "./types.js";

export type ResultProperty = "value" | "probability" | "confidence" | "accepted";
export type ComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";

/** One approved result field compared with a literal; never executable code. */
export interface ExpressionAst {
  decision: string;
  property: ResultProperty;
  operator: ComparisonOperator;
  literal: string | number | boolean;
}

export const decisionIdPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const expressionPattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\.(value|probability|confidence|accepted)\s*(==|!=|>=|<=|>|<)\s*("(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/;

/** Parse the complete restricted expression, rejecting trailing syntax. */
export function parseExpression(source: string): ExpressionAst {
  const match = expressionPattern.exec(source);
  if (!match) {
    throw new ExpressionParseError(`Invalid expression: ${source}. Expected <decision>.<value|probability|confidence|accepted> <comparison> <JSON string, number, or boolean>.`);
  }
  const [, decision, property, operator, token] = match;
  // The anchored grammar above guarantees these groups and a JSON primitive.
  const literal: unknown = JSON.parse(token!);
  if (typeof literal !== "string" && typeof literal !== "boolean" &&
      !(typeof literal === "number" && Number.isFinite(literal))) {
    throw new ExpressionParseError(`Expression literal must be a finite number, string, or boolean: ${source}`);
  }
  return { decision: decision!, property: property as ResultProperty, operator: operator as ComparisonOperator, literal };
}

/** Check references and operand types before inference is attempted. */
export function validateExpression(expression: ExpressionAst, decisions: Record<string, DecisionDefinition>): void {
  const expectedType = validateReference(expression, decisions);
  if (typeof expression.literal !== expectedType) {
    throw new ExpressionParseError(`"${expression.decision}.${expression.property}" requires a ${expectedType} literal`);
  }
  if (expression.operator !== "==" && expression.operator !== "!=" && expectedType !== "number") {
    throw new ExpressionParseError(`Operator "${expression.operator}" requires numeric operands`);
  }
}

/** Validate a result reference shared by expressions and return templates. */
export function validateReference(expression: Pick<ExpressionAst, 'decision' | 'property'>, decisions: Record<string, DecisionDefinition>): 'number' | 'string' | 'boolean' {
  if (!Object.hasOwn(decisions, expression.decision)) {
    throw new ExpressionParseError(`references unknown decision "${expression.decision}"`);
  }
  const decision = decisions[expression.decision]!;
  if (expression.property === "probability" && decision.decide === "scale") {
    throw new ExpressionParseError(`"${expression.decision}.probability" is not available for scale decisions`);
  }
  return expression.property === 'accepted' ? 'boolean'
    : expression.property !== "value" ? "number"
    : decision.decide === "one_of" ? "string"
    : decision.decide === "whether" ? "boolean" : "number";
}
