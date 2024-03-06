import { assert } from 'chai';
import { describe } from 'mocha';
import { HandlerChain } from '../src';

describe('HandlerChain', () => {

  type MyRequest = {
    action: string,
    message?: any,
  };

  function sleep(ms: number) {
    return new Promise<void>(re => {
      setTimeout(re, ms);
    });
  }

  describe('status code', () => {

    it('404', async () => {

      const ch = new HandlerChain<MyRequest>();

      ch.addHandler({
        handlers: [ ({ request, next, store }) => {
          if (request.action === 'hello') {
            store.counter++;
          }
          return next();
        } ],
        store: { counter: 0 },
      });

      const actual = await ch.handleRequest({
        action: 'hello',
        message: 1,
      });

      assert.deepEqual(actual.status, 404);


    });

    it('500', async () => {

      const ch = new HandlerChain<MyRequest>();
      const err = new Error('abc');
      ch.addHandler(() => {
        throw err;
      });

      const actual = await ch.handleRequest({ action: '123' });

      assert.deepEqual(actual.status, 500);
      assert.deepEqual(actual.error, err);


    });

    it('200', async () => {

      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(() => { });

      const actual = await ch.handleRequest({ action: '123' });

      assert.deepEqual(actual.status, 200);
      assert.isUndefined(actual.error);


    });

    it('setStatus no error', async () => {

      const expectStatus = 'myStatus';
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(({ setStatus }) => { setStatus(expectStatus); });

      const actual = await ch.handleRequest({ action: '123' });

      assert.deepEqual(actual.status, expectStatus);
      assert.isUndefined(actual.error);


    });

    it('setStatus with error', async () => {

      const expectStatus = 'my status';
      const expectError = new Error('my error');
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(({ setStatus }) => { setStatus(expectStatus, expectError); });

      const actual = await ch.handleRequest({ action: '123' });

      assert.deepEqual(actual.status, expectStatus);
      assert.deepEqual(actual.error, expectError);
    });

    it('getStatus', async () => {

      const ch = new HandlerChain<MyRequest>();
      const status: { status: number | string, error?: Error }[] = [];
      const error = new TypeError('err');
      ch.addHandler({
        handlers: [
          ({ getStatus, setStatus, next, store }) => {
            store.status.push(getStatus());
            setStatus(1);
            next();
            store.status.push(getStatus());
          },
          ({ getStatus, setStatus, store }) => {
            store.status.push(getStatus());
            setStatus(2, error);
          },
        ],
        store: { status },
      });

      await ch.handleRequest({ action: '123' });

      assert.deepEqual(status, [
        { status: 0, error: undefined },
        { status: 1, error: undefined },
        { status: 2, error },
      ]);

    });
  });

  describe('context', () => {

    it('request.handler fn', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(async ({ request }) => { });

      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
    });
    it('request.handler fn sync', async function() {
      this.slow(1400);
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(async () => {
        await sleep(500);
      });

      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
    });

    it('request.handler priority', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(() => 2, 10)
        .addHandler(() => 1, 5);

      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
      assert.deepEqual(actual.response, 1);
    });

    it('request.action', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(({ request }) => {
        return request.action;
      });

      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
      assert.deepEqual(actual.response, expectReq.action);
    });

    it('response chain', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch
        .addHandler(({ next }) => {
          return next() + '1';
        })
        .addHandler(({ next }) => {
          return next() + '2';
        })
        .addHandler(() => '3')
      ;

      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
      assert.deepEqual(actual.response, '321');
    });

    it('store', async () => {
      const expectReq: MyRequest = { action: 'abc', message: 'def' };
      const ch = new HandlerChain<MyRequest>();
      const store = { counter: 0 };
      ch.addHandler({
        handlers: ({ store }) => {
          return store.counter++;
        },
        store,
      });

      await ch.handleRequest(expectReq);
      await ch.handleRequest(expectReq);
      const actual = await ch.handleRequest(expectReq);

      assert.deepEqual(actual.status, 200);
      assert.deepEqual(actual.response, 2);
      assert.deepEqual(store.counter, 3);
    });
  });

  describe('chain', () => {

    describe('next', () => {

      it('next', async () => {
        const expectReq: MyRequest = { action: 'abc' };
        const ch = new HandlerChain<MyRequest>();
        const store = { history: [] as string[] };
        ch.addHandler({
          handlers: ({ next, store: { history } }) => {
            history.push('before');
            next();
            history.push('after');
          },
          store,
        }, 5)
          .addHandler({
            handlers: ({ store: { history } }) => {
              history.push('main');
            },
            store,
          }, 10);
  
        const actual = await ch.handleRequest(expectReq);
  
        assert.deepEqual(actual.status, 200);
        assert.deepEqual(store.history, [ 'before', 'main', 'after' ]);
      });
      it('next with edited request', async () => {
        const expectReq: MyRequest = { action: 'abc' };
        const ch = new HandlerChain<MyRequest>();
        const store = { history: [] as string[] };
        ch.addHandler({
          handlers: ({ request, next, store: { history } }) => {
            history.push('before');
            request.message = 'edited';
            next();
            history.push('after');
          },
          store,
        }, 5)
          .addHandler({
            handlers: ({ request: { message }, store: { history } }) => {
              history.push('main');
              history.push(message);
            },
            store,
          }, 10);
  
        const actual = await ch.handleRequest(expectReq);
  
        assert.deepEqual(actual.status, 200);
        assert.deepEqual(store.history, [ 'before', 'main', 'edited', 'after' ]);
      });
      it('nextSync', () => {
        const expectReq: MyRequest = { action: 'abc' };
        const ch = new HandlerChain<MyRequest>();
        const store = { history: [] as string[] };
        ch.addHandler({
          handlers: ({ nextSync, store: { history } }) => {
            history.push('before');
            history.push(nextSync() as string);
            history.push('after');
          },
          store,
        }, 5)
          .addHandler({
            handlers: () => {
              return 'main';
            },
            store,
          }, 10);
  
        const actual = ch.handleRequestSync(expectReq);
  
        assert.deepEqual(actual.status, 200);
        assert.deepEqual(store.history, [ 'before', 'main', 'after' ]);
      });
      it('nextAsync', async function() {
        this.slow(500);
        const expectReq: MyRequest = { action: 'abc' };
        const ch = new HandlerChain<MyRequest>();
        const store = { history: [] as string[] };
        ch.addHandler({
          handlers: async ({ nextAsync, store: { history } }) => {
            history.push('before');
            history.push(await nextAsync() as string);
            history.push('after');
          },
          store,
        }, 5)
          .addHandler({
            handlers: async () => {
              await sleep(200);
              return 'main';
            },
            store,
          }, 10);
  
        const actual = await ch.handleRequest(expectReq);
  
        assert.deepEqual(actual.status, 200);
        assert.deepEqual(store.history, [ 'before', 'main', 'after' ]);
      });
    });

    it('once', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler({
        handlers: () => 1,
        once: true,
      });
      ch.addHandler({
        handlers: () => 2,
        once: true,
      });

      const actual1 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual1.status, 200);
      assert.deepEqual(actual1.response, 1);

      const actual2 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual2.status, 200);
      assert.deepEqual(actual2.response, 2);
      assert.deepEqual(actual1.response, 1);

      const actual3 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual3.status, 404);
      assert.isUndefined(actual3.response);
    });

    it('once in Same set', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler({
        handlers: [ () => 1, () => 2 ],
        once: true,
      });
      ch.addHandler({
        handlers: () => 3,
        once: true,
      });

      const actual1 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual1.status, 200);
      assert.deepEqual(actual1.response, 1);

      const actual2 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual2.status, 200);
      assert.deepEqual(actual2.response, 2);
      assert.deepEqual(actual2.response, 2);

      const actual3 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual3.status, 200);
      assert.deepEqual(actual3.response, 3);
      assert.deepEqual(actual3.response, 3);

      const actual4 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual4.status, 404);
      assert.isUndefined(actual4.response);
    });

    it('remove handler', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler(({ removeHandler: removeHander }) => {
        removeHander();
        return 1;
      }).addHandler(() => 2);

      const actual1 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual1.status, 200);
      assert.deepEqual(actual1.response, 1);

      const actual2 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual2.status, 200);
      assert.deepEqual(actual2.response, 2);
      assert.deepEqual(actual2.response, 2);
    });

    it('remove handler same set', async () => {
      const expectReq: MyRequest = { action: 'abc' };
      const ch = new HandlerChain<MyRequest>();
      ch.addHandler({
        handlers: [
          ({ removeHandler: removeHander }) => {
            removeHander();
            return 1;
          },
          () => 2 ],
      }).addHandler({
        handlers: () => 3,
      });

      const actual1 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual1.status, 200);
      assert.deepEqual(actual1.response, 1);

      const actual2 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual2.status, 200);
      assert.deepEqual(actual2.response, 3);
      assert.deepEqual(actual2.response, 3);

      const actual3 = await ch.handleRequest(expectReq);
      assert.deepEqual(actual3.status, 200);
      assert.deepEqual(actual3.response, 3);
      assert.deepEqual(actual3.response, 3);
    });
  });
});
