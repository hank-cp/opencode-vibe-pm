/**
 * 日志工具测试
 *
 * 测试文件: tests/core/logger.test.ts
 * Setup: 不需要文件系统，纯单元测试
 */

import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { logger, initLogger, setLogEnabled } from '../../src/core/logger.js';

function createMockClient() {
  return {
    app: {
      log: (() => Promise.resolve(true)) as ReturnType<typeof mock>,
    },
  };
}

beforeEach(() => {
  const client = createMockClient();
  initLogger(client);
  setLogEnabled(true);
});

describe('logger', () => {
  it('logger_uninitialized_no_throw: 未初始化时调用不抛异常', () => {
    const _client = createMockClient();
    initLogger(null as unknown as ReturnType<typeof createMockClient>);

    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });

  it('logger_disabled_no_call: setLogEnabled(false) 抑制调用', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);
    setLogEnabled(false);

    logger.info('should not log');

    // 等待微任务
    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logger_re_enabled_calls: setLogEnabled(true) 恢复调用', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);
    setLogEnabled(false);
    setLogEnabled(true);

    logger.info('should log');

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('logger_info_calls_app_log: info 调用 app.log 传递正确参数', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    logger.info('hello world', { key: 'value' });

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const call = logSpy.mock.calls[0][0];
    expect(call.body.level).toBe('info');
    expect(call.body.message).toBe('[vibe-pm] hello world');
    expect(call.body.extra).toEqual({ key: 'value' });
    expect(call.body.service).toBeTruthy();
  });

  it('logger_debug_warn_error_levels: 各级别正确传递', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    logger.debug('debug msg');
    logger.warn('warn msg');
    logger.error('error msg');

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(3);
    const levels = logSpy.mock.calls.map((c) => c[0].body.level);
    expect(levels).toEqual(['debug', 'warn', 'error']);
  });

  it('logger_error_object_as_extra: Error 对象转换为 extra', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    const err = new Error('test error');
    logger.error('failed', err);

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const extra = logSpy.mock.calls[0][0].body.extra;
    expect(extra.error).toBe('test error');
    expect(extra.stack).toContain('test error');
  });

  it('logger_non_object_data_as_detail: 非对象 data 放入 detail', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    logger.info('msg', 42);

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].body.extra).toEqual({ detail: '42' });
  });

  it('logger_no_data_no_extra: 无 data 时不传 extra', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    logger.info('msg only');

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].body.extra).toBeUndefined();
  });

  it('logger_non_string_message: 非字符串 message 转字符串', async () => {
    const client = createMockClient();
    const logSpy = spyOn(client.app, 'log');
    initLogger(client);

    logger.info({ obj: 1 });

    await new Promise((r) => setTimeout(r, 0));
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].body.message).toBe('[vibe-pm] [object Object]');
  });
});
