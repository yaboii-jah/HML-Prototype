import { EMPTY_WORKSPACE_MARKER } from '../../src/mock/workspace-initialization.ts';

/** Record-loading tests exercise a workspace after its one-time cleanup has completed. */
export function initializedWorkspaceStorage(storage) {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'getItem') return key => key === EMPTY_WORKSPACE_MARKER ? '1' : target.getItem(key);
      return Reflect.get(target, property, receiver);
    },
  });
}
