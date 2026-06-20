import { AsyncLocalStorage } from "node:async_hooks";
import type {
  FlareBreadcrumb,
  FlareCaptureContext,
  FlareSpan,
  RequestScope,
} from "./types.js";

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithScope<T>(
  scope: Partial<RequestScope>,
  callback: () => T,
): T {
  return storage.run(
    {
      breadcrumbs: [],
      spans: [],
      ...scope,
    },
    callback,
  );
}

export function getScope(): RequestScope | undefined {
  return storage.getStore();
}

export function addScopedBreadcrumb(
  breadcrumb: FlareBreadcrumb,
  maxBreadcrumbs: number,
): boolean {
  const scope = getScope();
  if (!scope) return false;

  scope.breadcrumbs.push(breadcrumb);
  if (scope.breadcrumbs.length > maxBreadcrumbs) {
    scope.breadcrumbs.splice(0, scope.breadcrumbs.length - maxBreadcrumbs);
  }
  return true;
}

export function addScopedSpan(span: FlareSpan): boolean {
  const scope = getScope();
  if (!scope) return false;

  scope.spans.push(span);
  return true;
}

export function mergeScopeContext(
  scope: RequestScope | undefined,
  context: FlareCaptureContext,
): FlareCaptureContext {
  if (!scope) return context;

  return {
    ...context,
    request: { ...scope.request, ...context.request },
    trace: { ...scope.trace, ...context.trace },
    breadcrumbs: [...scope.breadcrumbs, ...(context.breadcrumbs ?? [])],
    spans: [...scope.spans, ...(context.spans ?? [])],
    contexts: { ...scope.contexts, ...context.contexts },
    tags: { ...scope.tags, ...context.tags },
    user: { ...scope.user, ...context.user },
    extra: { ...scope.extra, ...context.extra },
  };
}
