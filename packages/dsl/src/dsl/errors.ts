class BanhError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class DslParseError extends BanhError {}
export class DslValidationError extends BanhError {}
export class ExpressionParseError extends BanhError {}
export class ExpressionEvaluationError extends BanhError {}
export class BackendError extends BanhError {}
export class RuntimeError extends BanhError {}
