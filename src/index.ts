type Promisable<T> = T | PromiseLike<T>;

function isPromiseLike<T>(value:any):value is PromiseLike<T> {
  if (value === null) {
    return false;
  }
  
  if ((typeof value === 'object' || typeof value === 'function') && (typeof value.then === 'function')) {
    return true;
  }

  return false;
}


export type Task<Request, Response> = {
  recieveAt: number,
  finishedAt: number,

  request: Request,

  response: Response,
  error?: Error,

  status: string | number,
};
type SetStatusFn = (status: number | string, error?: Error) => void;
type GetStatusFn = () => {
  status: number | string,
  error?: Error,
};
export type Handler<Request = any, Response = any, Store extends object = object> = (args: {
  store: Store,
  request: Request,

  next: () => Promisable<Response>,
  
  /**
   * this an alias for `next`, use this API when you sure the request will be handled in *sync mode*
   */
  nextSync: () => Response,
  
  /**
   * this an alias for `next`, use this API when you sure the request will be handled in *async mode*
   */
  nextAsync: () => PromiseLike<Response>,

  setStatus: SetStatusFn,
  getStatus: GetStatusFn,

  /**
   * will also remove handlers in same HandlerSet
   */
  removeHandler: () => void,
}) => Promisable<Response>;

export type HandlerSet<Request = any, Response = any, Store extends object = object> = {
  store?: Store,
  handlers: Array<Handler<Request, Response, Store>> | Handler<Request, Response, Store>,
  once?: boolean,
};

export class HandlerChain<Request> {
  private readonly DEFAULT_PRIORITY = 10;
  private static readonly SetKey = Symbol('Handler-Setkey');

  private readonly handlers: Handler[][];

  constructor() {
    this.handlers = [];
  }

  private getHandlersWithPriority(priority: number): Handler[] {
    let handlers = this.handlers[priority];
    if (handlers === undefined) {
      handlers = this.handlers[priority] = [];
    }
    return handlers;
  }

  private getFlattenHandlers(): Handler[] {
    return this.handlers.flat(1);
  }

  /**
   * @param priority trigger order. Smaller gets the higher priority. int type, as Array index, min=0
   */
  addHandler<Response, Store extends object>(handlerSet: Handler<Request, Response, Store> | HandlerSet<Request, Response, Store>, priority = this.DEFAULT_PRIORITY) {
    const handlersWithPriority = this.getHandlersWithPriority(priority);
    if (typeof handlerSet === 'function') {
      handlerSet = {
        handlers: [ handlerSet ],
        once: false,
        store: {} as any,
      };
    }
    if (!Array.isArray(handlerSet.handlers)) {
      handlerSet.handlers = [ handlerSet.handlers ];
    }
    handlerSet.handlers.forEach(i => {
      i[HandlerChain.SetKey] = handlerSet;
    });
    handlerSet.store = handlerSet.store ?? {} as any;
    handlersWithPriority.push(...handlerSet.handlers);


    return this;
  }

  /**
   * will also remove handlers in same HandlerSet
   */
  removeHandler(handler: Handler): boolean {
    // const handlerSet: HandlerSet = handler[HandlerChain.SetKey];
    for (const i in this.handlers) {
      const iGroup = this.handlers[i];
      const idx = iGroup.findIndex(j => j === handler);
      if (idx > -1) {
        iGroup.splice(idx, 1);
        if (iGroup.length === 0) {
          delete this.handlers[i];
        }
        return true;
      }
    }
    return false;
  }

  /**
   * find and trigger handler process the given request.
   */
  handleRequest<Response>(request: Request): Promisable<Task<Request, Response>> {
    const THIS = this;
    function removeHander(this: Handler) {
      const handlerSet: HandlerSet = this[HandlerChain.SetKey];
      (handlerSet.handlers as []).forEach(i => THIS.removeHandler(i));
    }
    function next(handlers: Handler<Request, Response>[], idx: number, setStatus: SetStatusFn, getStatus:GetStatusFn): Promisable<Response> {
      const nextFn: (request?: Request) => Promisable<Response> = next.bind(null, handlers, idx + 1, setStatus, getStatus);
      const handler = handlers[idx];
      if (!handler) {
        setStatus(404);
        return;
      }
      const { store, once }: HandlerSet = handler[HandlerChain.SetKey];
      let re: Promisable<Response>;
      if (once) {
        THIS.removeHandler(handler);
      }
      try {
        re = handler({ 
          request, 
          next: nextFn, 
          // @ts-ignore
          nextAsync: nextFn, 
          // @ts-ignore
          nextSync: nextFn, 
          store, 
          setStatus, 
          getStatus,
          removeHandler: removeHander.bind(handler) });
      } catch (e) {
        setStatus(500, e);
      }
      return re;
    }
    const task: Task<Request, Response> = {
      recieveAt: Date.now(),
      finishedAt: -1,
      request,
      response: null,
      status: 0,
    };
    const handlers = this.getFlattenHandlers();
    const res = next(handlers, 0, (status, error) => { task.status = status; task.error = error; }, () => ({ status: task.status, error: task.error }));
    let p: Promise<Task<Request, Response>>;
    function final(response: Response) {
      task.response = response;
      task.finishedAt = Date.now();
      if (task.status === 0) {
        task.status = 200;
      }
    }
    if (isPromiseLike(res)) {
      let resolve: (task: Task<Request, Response>) => void;
      p = new Promise<Task<Request, Response>>(handler => {
        resolve = handler;
      });
      res.then(response => {
        final(response);
        resolve(task);
      });
      return p;
    }
    final(res);
    return task;
  }

  /**
   * this an alias for `handleRequest`, use this API when you sure the request will be handled in sync mode
   * @alias handleRequest
   */
  handleRequestSync<Response>(request: Request): Task<Request, Response> {
    return this.handleRequest(request) as any;
  }
}

