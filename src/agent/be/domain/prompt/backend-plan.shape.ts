import {
  ApiDesignPoint,
  BackendPlan,
  ImplementationCheckItem,
} from '../be-agent.type';

export const isBackendPlanShape = (value: unknown): value is BackendPlan => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.subject === 'string' &&
    typeof record.context === 'string' &&
    isImplementationChecklistArray(record.implementationChecklist) &&
    isApiDesignField(record.apiDesign) &&
    isStringArray(record.risks) &&
    isStringArray(record.testPoints) &&
    typeof record.estimatedHours === 'number' &&
    typeof record.reasoning === 'string'
  );
};

const isImplementationChecklistArray = (
  value: unknown,
): value is ImplementationCheckItem[] =>
  Array.isArray(value) && value.every(isImplementationCheckItemShape);

const isImplementationCheckItemShape = (
  value: unknown,
): value is ImplementationCheckItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.title === 'string' &&
    typeof record.description === 'string' &&
    isStringArray(record.dependsOn)
  );
};

const isApiDesignField = (value: unknown): value is ApiDesignPoint[] | null => {
  if (value === null) {
    return true;
  }
  return Array.isArray(value) && value.every(isApiDesignPointShape);
};

const isApiDesignPointShape = (value: unknown): value is ApiDesignPoint => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.method === 'string' &&
    typeof record.path === 'string' &&
    typeof record.request === 'string' &&
    typeof record.response === 'string' &&
    typeof record.notes === 'string'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
