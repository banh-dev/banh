import { ExpressionEvaluationError } from '@banh/dsl';
import type { ExpressionAst } from '@banh/dsl';
import type { ExecutionContext } from "./execution-context.js";

/** Compare typed values without coercion; unavailable metadata is an error. */
export function evaluateExpression(expression: ExpressionAst, context: ExecutionContext): boolean {
  const { decision, property, operator, literal: right } = expression;
  if (!Object.hasOwn(context.decisions, decision)) {
    throw new ExpressionEvaluationError(`Unknown decision "${decision}"`);
  }
  const left = context.decisions[decision]![property];
  if (left === undefined) throw new ExpressionEvaluationError(`Result "${decision}.${property}" is unavailable`);
  if (typeof left !== typeof right || (typeof left === "number" && !Number.isFinite(left))) {
    throw new ExpressionEvaluationError(`Incompatible operands for "${decision}.${property}"`);
  }
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(right)) {
    throw new ExpressionEvaluationError(`Operator "${operator}" requires finite numeric operands`);
  }
  switch (operator) {
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
  }
}
