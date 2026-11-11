import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, mockFetch, seedSession, jsonResponse } from './helpers/env.mjs';
import { liveGetVideo, liveLikeVideo, liveUnlikeVideo, liveTrackVideoTime } from '../../src/api/live.js';

const pathOf = (call) => {
  const url = new URL(call.url);
  return url.pathname + url.search;
};

beforeEach(() => {
  resetDom();
  seedSession();
});

test('liveGetVideo fetches the video by id with the session token', async () => {
  const calls = mockFetch(() => ({ id: 'v1', title: 'Live' }));
  assert.deepEqual(await liveGetVideo('v1'), { id: 'v1', title: 'Live' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/addon/live/video?id=v1');
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
});

test('liveGetVideo rejects when the API fails', async () => {
  mockFetch(() => jsonResponse({}, { status: 404 }));
  await assert.rejects(liveGetVideo('missing'), /GET request failed: 404/);
});

test('liveLikeVideo patches the like endpoint', async () => {
  const calls = mockFetch(() => ({ likes: 3 }));
  assert.deepEqual(await liveLikeVideo('v1'), { likes: 3 });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(pathOf(calls[0]), '/addon/live/video/v1/like');
  assert.deepEqual(calls[0].body, {});
});

test('liveUnlikeVideo patches the unlike endpoint', async () => {
  const calls = mockFetch(() => ({ likes: 2 }));
  assert.deepEqual(await liveUnlikeVideo('v1'), { likes: 2 });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(pathOf(calls[0]), '/addon/live/video/v1/unlike');
  assert.deepEqual(calls[0].body, {});
});

test('liveTrackVideoTime sends the watched time and the view id', async () => {
  const calls = mockFetch(() => ({ ok: true }));
  assert.deepEqual(await liveTrackVideoTime('v1', 42, 'view-9'), { ok: true });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(pathOf(calls[0]), '/addon/live/video/v1/time');
  assert.deepEqual(calls[0].body, { time: 42, videoViewId: 'view-9' });
});

test('live mutations reject when the API fails', async () => {
  mockFetch(() => jsonResponse({}, { status: 500 }));
  await assert.rejects(liveLikeVideo('v1'), /PATCH request failed: 500/);
});
