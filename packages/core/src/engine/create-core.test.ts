import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRssCloudCore } from './create-core.js';
import { resolveConfig } from '../config.js';
import { createEventBus } from '../events.js';
import type { RssCloudEventMap } from '../events.js';
import { createInMemoryStore } from '../store/memory-store.js';
import type { ProtocolPlugin, VerifyContext } from './plugin.js';
import type { Resource } from './resource.js';
import type { Store } from '../store/store.js';
import type { Subscription } from './subscription.js';

const FEED = 'https://feed.example/rss';
const RSS = '<rss><channel><title>Hi</title></channel></rss>';

function fetchReturning(body: string, status = 200): typeof fetch {
    return vi.fn(
        async () => new Response(body, { status })
    ) as unknown as typeof fetch;
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
    return {
        url: 'https://sub.example/notify',
        protocol: 'http-post',
        ctUpdates: 0,
        ctErrors: 0,
        ctConsecutiveErrors: 0,
        whenCreated: new Date(0),
        whenLastUpdate: null,
        whenLastError: null,
        whenExpires: new Date('2099-01-01T00:00:00Z'),
        ...overrides
    };
}

function deliverPlugin(
    deliver: ProtocolPlugin['deliver'],
    protocols: ProtocolPlugin['protocols'] = ['http-post', 'https-post']
): ProtocolPlugin {
    return {
        protocols,
        verify: async () => undefined,
        deliver
    };
}

function resource(overrides: Partial<Resource> = {}): Resource {
    return {
        url: FEED,
        lastHash: 'hash',
        lastSize: 1,
        ctChecks: 1,
        whenLastCheck: new Date(0),
        ctUpdates: 0,
        whenLastUpdate: new Date(0),
        ...overrides
    };
}

function makePlugin(overrides: Partial<ProtocolPlugin> = {}): ProtocolPlugin {
    return {
        protocols: ['http-post', 'https-post'],
        verify: vi.fn(async () => undefined),
        deliver: vi.fn(async () => ({ ok: true })),
        ...overrides
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('createRssCloudCore ping', () => {
    it('records a first ping as a change and stores the resource', async () => {
        const store = createInMemoryStore();

        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const result = await core.ping({ resourceUrl: FEED });

        expect(result.success).toBe(true);

        const stored = await store.getResource(FEED);
        expect(stored?.ctChecks).toBe(1);
        expect(stored?.ctUpdates).toBe(1);
        expect(stored?.lastSize).toBe(RSS.length);
        expect(stored?.lastHash).not.toBe('');
        expect(stored?.feed).toMatchObject({ title: 'Hi' });
    });

    it('rejects a ping that arrives sooner than the minimum interval', async () => {
        const store = createInMemoryStore();
        const fixedNow = new Date('2026-01-01T00:00:00Z');
        await store.putResource(FEED, {
            url: FEED,
            lastHash: 'h',
            lastSize: 1,
            ctChecks: 1,
            whenLastCheck: fixedNow,
            ctUpdates: 0,
            whenLastUpdate: fixedNow
        });
        const fetchMock = fetchReturning(RSS);

        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig({ minSecsBetweenPings: 60 }),
            fetch: fetchMock,
            now: () => fixedNow
        });

        await expect(core.ping({ resourceUrl: FEED })).rejects.toMatchObject({
            code: 'PING_TOO_RECENT'
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts a ping once exactly the minimum interval has elapsed', async () => {
        const store = createInMemoryStore();
        const fixedNow = new Date('2026-01-01T00:01:00Z');
        await store.putResource(
            FEED,
            resource({ whenLastCheck: new Date('2026-01-01T00:00:00Z') })
        );
        const fetchMock = fetchReturning(RSS);

        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig({ minSecsBetweenPings: 60 }),
            fetch: fetchMock,
            now: () => fixedNow
        });

        const result = await core.ping({ resourceUrl: FEED });

        expect(result.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects when the resource responds non-2xx', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning('error', 500)
        });

        await expect(core.ping({ resourceUrl: FEED })).rejects.toMatchObject({
            code: 'RESOURCE_READ_FAILED'
        });
    });

    it('rejects when the resource fetch throws', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;

        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchMock
        });

        await expect(core.ping({ resourceUrl: FEED })).rejects.toMatchObject({
            code: 'RESOURCE_READ_FAILED'
        });
    });

    it('does not re-notify when the feed is unchanged', async () => {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await core.ping({ resourceUrl: FEED });
        await core.ping({ resourceUrl: FEED });

        const stored = await store.getResource(FEED);
        expect(stored?.ctChecks).toBe(2);
        expect(stored?.ctUpdates).toBe(1);
    });

    it('treats an empty body as a change without parsing a feed', async () => {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning('')
        });

        await core.ping({ resourceUrl: FEED });

        const stored = await store.getResource(FEED);
        expect(stored?.lastSize).toBe(0);
        expect(stored?.feed).toBeUndefined();
        expect(stored?.ctUpdates).toBe(1);
    });

    it('re-attempts feed parsing while metadata is still unknown', async () => {
        const parse = vi.fn(async () => null);
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning('<notafeed/>'),
            feedParser: { parse }
        });

        await core.ping({ resourceUrl: FEED });
        await core.ping({ resourceUrl: FEED });

        expect(parse).toHaveBeenCalledTimes(2);
    });

    it('emits a ping event describing the result', async () => {
        const pings: RssCloudEventMap['ping'][] = [];
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('ping', event => pings.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(pings[0]).toMatchObject({ resourceUrl: FEED, changed: true });
        expect(typeof pings[0]?.durationMs).toBe('number');
    });
});

describe('createRssCloudCore ping fan-out', () => {
    it('notifies an active subscriber when the feed changes', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [subscription()]);
        const deliver = vi.fn(async () => ({ ok: true }));
        const notifies: RssCloudEventMap['notify'][] = [];
        const changes: RssCloudEventMap['resourceChanged'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver)],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('notify', event => notifies.push(event));
        core.events.on('resourceChanged', event => changes.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(deliver).toHaveBeenCalledTimes(1);
        expect(notifies).toHaveLength(1);
        expect(changes[0]).toMatchObject({ subscriberCount: 1 });

        const subs = await store.getSubscriptions(FEED);
        expect(subs[0]?.ctUpdates).toBe(1);
        expect(subs[0]?.ctConsecutiveErrors).toBe(0);
        expect(subs[0]?.whenLastUpdate).not.toBeNull();
    });

    it('records a delivery failure with the error message', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [subscription()]);
        const deliver = vi.fn(async () => ({
            ok: false,
            error: new Error('boom')
        }));
        const failures: RssCloudEventMap['notifyFailed'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver)],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('notifyFailed', event => failures.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(failures[0]).toMatchObject({ error: 'boom' });
        const subs = await store.getSubscriptions(FEED);
        expect(subs[0]?.ctErrors).toBe(1);
        expect(subs[0]?.ctConsecutiveErrors).toBe(1);
        expect(subs[0]?.whenLastError).not.toBeNull();
    });

    it('falls back to a default message when a failed delivery has no error', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [subscription()]);
        const deliver = vi.fn(async () => ({ ok: false }));
        const failures: RssCloudEventMap['notifyFailed'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver)],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('notifyFailed', event => failures.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(failures[0]?.error).toBe('Notification failed');
    });

    it('records a failure when no plugin handles the subscription protocol', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ protocol: 'xml-rpc' })
        ]);
        const failures: RssCloudEventMap['notifyFailed'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('notifyFailed', event => failures.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(failures).toHaveLength(1);
        const subs = await store.getSubscriptions(FEED);
        expect(subs[0]?.ctConsecutiveErrors).toBe(1);
    });

    it('skips expired and error-exhausted subscribers during fan-out', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ url: 'https://active.example/notify' }),
            subscription({
                url: 'https://expired.example/notify',
                whenExpires: new Date('2000-01-01T00:00:00Z')
            }),
            subscription({
                url: 'https://errored.example/notify',
                ctConsecutiveErrors: 3
            })
        ]);
        const deliver = vi.fn(async () => ({ ok: true }));
        const changes: RssCloudEventMap['resourceChanged'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver)],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('resourceChanged', event => changes.push(event));

        await core.ping({ resourceUrl: FEED });

        expect(deliver).toHaveBeenCalledTimes(1);
        expect(changes[0]?.subscriberCount).toBe(1);
    });

    it('passes the changed resource and payload to the plugin', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [subscription()]);
        const deliver = vi.fn<ProtocolPlugin['deliver']>(async () => ({
            ok: true
        }));

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver)],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await core.ping({ resourceUrl: FEED });

        const ctx = deliver.mock.calls[0]?.[0];
        expect(ctx?.resource.url).toBe(FEED);
        expect(ctx?.payload.body).toBe(RSS);
    });
});

describe('createRssCloudCore subscribe', () => {
    it('rejects a request with no resources', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await expect(
            core.subscribe({
                resourceUrls: [],
                callbackUrl: 'https://sub.example/notify',
                protocol: 'http-post'
            })
        ).rejects.toMatchObject({ code: 'NO_RESOURCES' });
    });

    it('rejects a protocol with no registered plugin', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await expect(
            core.subscribe({
                resourceUrls: [FEED],
                callbackUrl: 'https://sub.example/notify',
                protocol: 'xml-rpc'
            })
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
    });

    it('seeds the resource, verifies, and stores a minimal subscription', async () => {
        const store = createInMemoryStore();
        const verify = vi.fn(async () => undefined);
        const events: RssCloudEventMap['subscribe'][] = [];

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ verify })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        core.events.on('subscribe', event => events.push(event));

        const response = await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(true);
        expect(response.results).toEqual([
            { resourceUrl: FEED, success: true }
        ]);
        expect(verify).toHaveBeenCalledWith(
            expect.objectContaining({ resourceUrl: FEED, diffDomain: false })
        );
        expect(events[0]).toMatchObject({ resourceUrl: FEED });

        const subs = await store.getSubscriptions(FEED);
        expect(subs).toHaveLength(1);
        expect(subs[0]).toMatchObject({
            url: 'https://sub.example/notify',
            protocol: 'http-post',
            ctUpdates: 1
        });
        expect(subs[0]?.notifyProcedure).toBeUndefined();
        expect(subs[0]?.whenExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('stores notifyProcedure and details when provided', async () => {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post',
            notifyProcedure: 'river.feedUpdated',
            details: { secret: 's3cret' }
        });

        const subs = await store.getSubscriptions(FEED);
        expect(subs[0]?.notifyProcedure).toBe('river.feedUpdated');
        expect(subs[0]?.details).toEqual({ secret: 's3cret' });
    });

    it('passes diffDomain through to plugin verification', async () => {
        const verify = vi.fn(async () => undefined);
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin({ verify })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post',
            diffDomain: true
        });

        expect(verify).toHaveBeenCalledWith(
            expect.objectContaining({ diffDomain: true })
        );
    });

    it('reports a per-resource failure when verification fails', async () => {
        const store = createInMemoryStore();
        const verify = vi.fn(async () => {
            throw new Error('challenge mismatch');
        });

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ verify })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const response = await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(false);
        expect(response.results?.[0]).toMatchObject({
            success: false,
            errorCode: 'SUBSCRIPTION_VERIFICATION_FAILED'
        });
        expect(await store.getSubscriptions(FEED)).toHaveLength(0);
    });

    it('reports a per-resource failure when the resource cannot be read', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning('nope', 500)
        });

        const response = await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(false);
        expect(response.results?.[0]?.errorCode).toBe('RESOURCE_READ_FAILED');
    });

    it('reports a failure when seeding the resource throws unexpectedly', async () => {
        const store: Store = {
            ...createInMemoryStore(),
            getResource: async () => {
                throw new Error('store down');
            }
        };

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const response = await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(false);
        expect(response.results?.[0]?.success).toBe(false);
    });

    it('tolerates a too-recent seed ping and still subscribes', async () => {
        const store = createInMemoryStore();
        const fixedNow = new Date('2026-01-01T00:00:00Z');
        await store.putResource(FEED, {
            url: FEED,
            lastHash: 'h',
            lastSize: 1,
            ctChecks: 1,
            whenLastCheck: fixedNow,
            ctUpdates: 0,
            whenLastUpdate: fixedNow
        });

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig({ minSecsBetweenPings: 60 }),
            fetch: fetchReturning(RSS),
            now: () => fixedNow
        });

        const response = await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(true);
        expect(await store.getSubscriptions(FEED)).toHaveLength(1);
    });

    it('renews an existing subscription instead of duplicating it', async () => {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });
        const request = {
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post' as const
        };

        await core.subscribe(request);
        await core.subscribe(request);

        const subs = await store.getSubscriptions(FEED);
        expect(subs).toHaveLength(1);
        expect(subs[0]?.ctUpdates).toBe(2);
    });

    it('updates procedure and details when renewing', async () => {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });
        await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post',
            notifyProcedure: 'river.feedUpdated',
            details: { secret: 's3cret' }
        });

        const subs = await store.getSubscriptions(FEED);
        expect(subs).toHaveLength(1);
        expect(subs[0]?.notifyProcedure).toBe('river.feedUpdated');
        expect(subs[0]?.details).toEqual({ secret: 's3cret' });
    });

    it('succeeds overall when at least one resource subscribes', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: vi.fn(async (url: string | URL) =>
                String(url).includes('good')
                    ? new Response(RSS, { status: 200 })
                    : new Response('nope', { status: 500 })
            ) as unknown as typeof fetch
        });

        const response = await core.subscribe({
            resourceUrls: [
                'https://good.example/rss',
                'https://bad.example/rss'
            ],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(true);
        expect(response.results).toHaveLength(2);
        expect(response.results?.filter(r => r.success)).toHaveLength(1);
    });
});

describe('createRssCloudCore unsubscribe', () => {
    it('removes the matching subscription', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ url: 'https://sub.example/notify' }),
            subscription({ url: 'https://other.example/notify' })
        ]);

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const response = await core.unsubscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'http-post'
        });

        expect(response.success).toBe(true);
        const subs = await store.getSubscriptions(FEED);
        expect(subs.map(s => s.url)).toEqual(['https://other.example/notify']);
    });

    it('is a no-op when nothing matches', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ url: 'https://sub.example/notify' })
        ]);

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const response = await core.unsubscribe({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/notify',
            protocol: 'xml-rpc'
        });

        expect(response.success).toBe(true);
        expect(await store.getSubscriptions(FEED)).toHaveLength(1);
    });
});

describe('createRssCloudCore acceptUnsubscription', () => {
    function captureScheduler(): {
        tasks: (() => Promise<void>)[];
        schedule: (task: () => Promise<void>) => void;
    } {
        const tasks: (() => Promise<void>)[] = [];
        return { tasks, schedule: task => void tasks.push(task) };
    }

    const CALLBACK = 'https://sub.example/listener';

    it('schedules a verified unsubscribe that removes the sub on a confirmed intent', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ url: CALLBACK, protocol: 'websub' })
        ]);
        const scheduler = captureScheduler();
        const verify = vi.fn<(ctx: VerifyContext) => Promise<undefined>>(
            async () => undefined
        );

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'], verify })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptUnsubscription({
            resourceUrls: [FEED],
            callbackUrl: CALLBACK,
            protocol: 'websub'
        });

        // Returns immediately: queued, not run — still subscribed.
        expect(scheduler.tasks).toHaveLength(1);
        expect(await store.getSubscriptions(FEED)).toHaveLength(1);

        await scheduler.tasks[0]?.();

        expect(await store.getSubscriptions(FEED)).toEqual([]);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(verify.mock.calls[0]?.[0]).toMatchObject({
            mode: 'unsubscribe',
            resourceUrl: FEED
        });
    });

    it('keeps the subscription when the unsubscribe intent is not confirmed', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ url: CALLBACK, protocol: 'websub' })
        ]);
        const scheduler = captureScheduler();

        const core = createRssCloudCore({
            store,
            plugins: [
                makePlugin({
                    protocols: ['websub'],
                    verify: vi.fn(async () => {
                        throw new Error('callback did not echo the challenge');
                    })
                })
            ],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptUnsubscription({
            resourceUrls: [FEED],
            callbackUrl: CALLBACK,
            protocol: 'websub'
        });

        // A refusal is expected, not an error: the task resolves cleanly.
        await scheduler.tasks[0]?.();

        expect(await store.getSubscriptions(FEED)).toHaveLength(1);
    });

    it('does not verify or remove anything when no matching subscription exists', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({
                url: 'https://other.example/listener',
                protocol: 'websub'
            })
        ]);
        const scheduler = captureScheduler();
        const verify = vi.fn(async () => undefined);

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'], verify })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptUnsubscription({
            resourceUrls: [FEED],
            callbackUrl: CALLBACK,
            protocol: 'websub'
        });

        await scheduler.tasks[0]?.();

        expect(verify).not.toHaveBeenCalled();
        expect(await store.getSubscriptions(FEED)).toHaveLength(1);
    });

    it('surfaces an error when no plugin is registered for the protocol', async () => {
        const store = createInMemoryStore();
        const scheduler = captureScheduler();

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin()],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptUnsubscription({
            resourceUrls: [FEED],
            callbackUrl: CALLBACK,
            protocol: 'websub'
        });

        await expect(scheduler.tasks[0]?.()).rejects.toThrow();
    });
});

describe('createRssCloudCore acceptPublish', () => {
    it('re-fetches the topic and fans out to subscribers', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ protocol: 'websub' })
        ]);
        const deliver = vi.fn(async () => ({ ok: true }));

        const core = createRssCloudCore({
            store,
            plugins: [deliverPlugin(deliver, ['websub'])],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const result = core.acceptPublish({ resourceUrl: FEED });
        expect(result).toBeUndefined();

        // The publish is acknowledged immediately; the fetch runs out of band.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(deliver).toHaveBeenCalledTimes(1);
    });

    it('routes a failed publish fetch to the error event', async () => {
        const events = createEventBus();
        const errors: RssCloudEventMap['error'][] = [];
        events.on('error', payload => void errors.push(payload));

        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [
                deliverPlugin(
                    vi.fn(async () => ({ ok: true })),
                    ['websub']
                )
            ],
            config: resolveConfig(),
            fetch: fetchReturning('Not Found', 404),
            events
        });

        core.acceptPublish({ resourceUrl: FEED });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.scope).toBe('websub-publish');
        expect(errors[0]?.error).toBeInstanceOf(Error);
    });

    it('coerces a non-Error publish rejection into an Error on the error event', async () => {
        const base = createInMemoryStore();
        await base.putSubscriptions(FEED, [
            subscription({ protocol: 'websub' })
        ]);
        // A misbehaving store that rejects the fan-out write with a non-Error.
        const store: Store = {
            ...base,
            putSubscriptions: async (feedUrl, subscriptions) => {
                if (subscriptions.length > 0) {
                    throw 'store exploded';
                }
                await base.putSubscriptions(feedUrl, subscriptions);
            }
        };
        const events = createEventBus();
        const errors: RssCloudEventMap['error'][] = [];
        events.on('error', payload => void errors.push(payload));

        const core = createRssCloudCore({
            store,
            plugins: [
                deliverPlugin(
                    vi.fn(async () => ({ ok: true })),
                    ['websub']
                )
            ],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            events
        });

        core.acceptPublish({ resourceUrl: FEED });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.error).toBeInstanceOf(Error);
        expect(errors[0]?.error.message).toBe('store exploded');
    });
});

describe('createRssCloudCore websub leases', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');
    const CALLBACK = 'https://sub.example/listener';

    function leaseCore(verify: ProtocolPlugin['verify']) {
        const store = createInMemoryStore();
        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'], verify })],
            config: resolveConfig({
                webSubLeaseDefaultSecs: 86400,
                webSubLeaseMinSecs: 300,
                webSubLeaseMaxSecs: 864000
            }),
            fetch: fetchReturning(RSS),
            now: () => NOW
        });
        return { store, core };
    }

    async function subscribeWebSub(details?: Record<string, unknown>) {
        const verify = vi.fn<(ctx: VerifyContext) => Promise<undefined>>(
            async () => undefined
        );
        const { store, core } = leaseCore(verify);
        await core.subscribe({
            resourceUrls: [FEED],
            callbackUrl: CALLBACK,
            protocol: 'websub',
            ...(details ? { details } : {})
        });
        const sub = (await store.getSubscriptions(FEED))[0];
        return { sub, verify };
    }

    it('clamps a too-small requested lease up to the minimum and records it', async () => {
        const { sub, verify } = await subscribeWebSub({ leaseSeconds: 5 });

        expect(sub?.details).toEqual({ leaseSeconds: 300 });
        expect(sub?.whenExpires).toEqual(new Date(NOW.getTime() + 300 * 1000));
        expect(verify.mock.calls[0]?.[0]).toMatchObject({ leaseSeconds: 300 });
    });

    it('clamps a too-large requested lease down to the maximum', async () => {
        const { sub } = await subscribeWebSub({ leaseSeconds: 99999999 });

        expect(sub?.details).toEqual({ leaseSeconds: 864000 });
        expect(sub?.whenExpires).toEqual(
            new Date(NOW.getTime() + 864000 * 1000)
        );
    });

    it('grants the default lease when none is requested', async () => {
        const { sub } = await subscribeWebSub();

        expect(sub?.details).toEqual({ leaseSeconds: 86400 });
        expect(sub?.whenExpires).toEqual(
            new Date(NOW.getTime() + 86400 * 1000)
        );
    });

    it('preserves a supplied secret alongside the chosen lease', async () => {
        const { sub } = await subscribeWebSub({
            secret: 's3cr3t',
            leaseSeconds: 3600
        });

        expect(sub?.details).toEqual({ secret: 's3cr3t', leaseSeconds: 3600 });
    });
});

describe('createRssCloudCore initialization', () => {
    it('runs each plugin init hook once', () => {
        const init = vi.fn();
        createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [makePlugin({ init })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        expect(init).toHaveBeenCalledTimes(1);
    });

    it('defaults to the global fetch and accepts a provided event bus', async () => {
        const events = createEventBus();
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            events
        });

        expect(core.events).toBe(events);
        const stats = await core.generateStats();
        expect(stats.feedsWithSubscribers).toBe(0);
    });

    it('delegates removeExpired to the maintenance job', async () => {
        const store = createInMemoryStore();
        await store.putSubscriptions(FEED, [
            subscription({ whenExpires: new Date('2000-01-01T00:00:00Z') })
        ]);
        const core = createRssCloudCore({
            store,
            plugins: [],
            config: resolveConfig(),
            now: () => new Date('2026-06-01T00:00:00Z')
        });

        const result = await core.removeExpired();

        expect(result.subscriptionsRemoved).toBe(1);
        expect(await store.list()).toHaveLength(0);
    });
});

describe('createRssCloudCore async store construction', () => {
    it('accepts a Promise<Store>, resolving it once for operations', async () => {
        const store = createInMemoryStore();

        const core = createRssCloudCore({
            store: Promise.resolve(store),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        const result = await core.ping({ resourceUrl: FEED });

        expect(result.success).toBe(true);
        expect((await store.getResource(FEED))?.ctChecks).toBe(1);
    });

    it('close() awaits construction and closes a store that can close', async () => {
        const close = vi.fn(async () => undefined);
        const inner = { ...createInMemoryStore(), close };

        const core = createRssCloudCore({
            store: Promise.resolve(inner),
            plugins: [],
            config: resolveConfig()
        });

        await core.close();

        expect(close).toHaveBeenCalledOnce();
    });

    it('close() is a no-op when the store has no close lifecycle', async () => {
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig()
        });

        await expect(core.close()).resolves.toBeUndefined();
    });
});

describe('createRssCloudCore listFeeds', () => {
    it('returns a snapshot of every tracked feed', async () => {
        const inner = createInMemoryStore();
        await inner.putResource(FEED, resource());
        await inner.putSubscriptions(FEED, [subscription()]);

        const core = createRssCloudCore({
            store: inner,
            plugins: [],
            config: resolveConfig()
        });

        const feeds = await core.listFeeds();

        expect(feeds).toEqual([
            {
                feedUrl: FEED,
                resource: resource(),
                subscriptions: [subscription()]
            }
        ]);
    });
});

describe('createRssCloudCore feed seeding', () => {
    function freshCore() {
        return createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig()
        });
    }

    it('seedResource persists a resource that listFeeds reflects', async () => {
        const core = freshCore();

        await core.seedResource(FEED, resource());

        expect(await core.listFeeds()).toEqual([
            { feedUrl: FEED, resource: resource(), subscriptions: [] }
        ]);
    });

    it('seedSubscriptions persists subscriptions that listFeeds reflects', async () => {
        const core = freshCore();

        await core.seedSubscriptions(FEED, [subscription()]);

        expect(await core.listFeeds()).toEqual([
            { feedUrl: FEED, resource: null, subscriptions: [subscription()] }
        ]);
    });

    it('clearFeeds removes every tracked feed', async () => {
        const core = freshCore();
        await core.seedResource(FEED, resource());
        await core.seedSubscriptions('https://other.example/rss', [
            subscription()
        ]);

        await core.clearFeeds();

        expect(await core.listFeeds()).toEqual([]);
    });
});

describe('createRssCloudCore acceptSubscription', () => {
    function captureScheduler(): {
        tasks: (() => Promise<void>)[];
        schedule: (task: () => Promise<void>) => void;
    } {
        const tasks: (() => Promise<void>)[] = [];
        return { tasks, schedule: task => void tasks.push(task) };
    }

    it('schedules verify→persist and persists a websub subscription on success', async () => {
        const store = createInMemoryStore();
        const scheduler = captureScheduler();

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'] })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptSubscription({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/listener',
            protocol: 'websub',
            details: { leaseSeconds: 600 }
        });

        // Returns immediately: the task is queued, not run — nothing persisted.
        expect(scheduler.tasks).toHaveLength(1);
        expect(await store.getSubscriptions(FEED)).toEqual([]);

        await scheduler.tasks[0]?.();

        const subs = await store.getSubscriptions(FEED);
        expect(subs).toHaveLength(1);
        expect(subs[0]).toMatchObject({
            url: 'https://sub.example/listener',
            protocol: 'websub',
            details: { leaseSeconds: 600 }
        });
    });

    it('persists nothing when the scheduled verification fails', async () => {
        const store = createInMemoryStore();
        const scheduler = captureScheduler();

        const core = createRssCloudCore({
            store,
            plugins: [
                makePlugin({
                    protocols: ['websub'],
                    verify: vi.fn(async () => {
                        throw new Error('callback did not echo the challenge');
                    })
                })
            ],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            scheduler
        });

        core.acceptSubscription({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/listener',
            protocol: 'websub'
        });

        await scheduler.tasks[0]?.();

        expect(await store.getSubscriptions(FEED)).toEqual([]);
    });

    it('runs the verify→persist on the default in-process scheduler when none is injected', async () => {
        const store = createInMemoryStore();

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'] })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS)
        });

        core.acceptSubscription({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/listener',
            protocol: 'websub'
        });

        // The default scheduler runs out of band; let the microtask drain.
        await new Promise(resolve => setTimeout(resolve, 0));

        const subs = await store.getSubscriptions(FEED);
        expect(subs).toHaveLength(1);
        expect(subs[0]).toMatchObject({
            url: 'https://sub.example/listener',
            protocol: 'websub'
        });
    });

    it('surfaces a thrown verify→persist task via the error event', async () => {
        const events = createEventBus();
        const errors: RssCloudEventMap['error'][] = [];
        events.on('error', payload => void errors.push(payload));

        // No 'websub' plugin registered → subscribe throws UNSUPPORTED_PROTOCOL.
        const core = createRssCloudCore({
            store: createInMemoryStore(),
            plugins: [],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            events
        });

        core.acceptSubscription({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/listener',
            protocol: 'websub'
        });

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.scope).toBe('websub-verification');
        expect(errors[0]?.error).toBeInstanceOf(Error);
    });

    it('coerces a non-Error rejection into an Error on the error event', async () => {
        const base = createInMemoryStore();
        // A misbehaving store that rejects the success-path write (1 sub) with a
        // non-Error value; the empty pre-ping write (0 subs) still succeeds.
        const store: Store = {
            ...base,
            putSubscriptions: async (feedUrl, subscriptions) => {
                if (subscriptions.length > 0) {
                    throw 'store exploded';
                }
                await base.putSubscriptions(feedUrl, subscriptions);
            }
        };
        const events = createEventBus();
        const errors: RssCloudEventMap['error'][] = [];
        events.on('error', payload => void errors.push(payload));

        const core = createRssCloudCore({
            store,
            plugins: [makePlugin({ protocols: ['websub'] })],
            config: resolveConfig(),
            fetch: fetchReturning(RSS),
            events
        });

        core.acceptSubscription({
            resourceUrls: [FEED],
            callbackUrl: 'https://sub.example/listener',
            protocol: 'websub'
        });

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.error).toBeInstanceOf(Error);
        expect(errors[0]?.error.message).toBe('store exploded');
    });
});
