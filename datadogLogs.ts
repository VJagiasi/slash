export const logs = createLogs();

interface ApiRequestLog extends BaseLogFormat {
  discriminator: 'slash.events.api_request';
  duration: number;
  http: {
    method: 'POST' | 'GET';
    route: string;
  }
  status_code: number;
}
/*
Defines a log that can be used anywhere. Below is a log that gets forwarded to datadog:
  ```ts
  apiRequestLog.record({
    discriminator: 'slash.events.api_request',
    duration: 100,
    http: { method: 'GET', route: '/' },
    status_code: 200
  });
  ```
*/
const apiRequestLog = logs.createStructuredLog({
  type: logs.type<ApiRequestLog>('slash.events.api_request')
});

const metric = logs.createMetric(apiRequestLog, {
  name: 'slow_http_requests',
  compute: {
    type: 'distribution',
    path: _ => _.log.discriminator,
    includePercentiles: true
  },
  filter: _ => _.and(
    _.gt(_.log.duration, 100),
    _.equals(_.log.discriminator, 'slash.events.api_request')
  )
});

/*
this should pass typecheck. Update GetDatadogLogPreviewResponse so that it returns the correct type
note: if you do not get a type error, it may be because:
  1. the type evaluates to `\`<some_string>${any}\``
  2. the type evaluates to `\`<some_string>${string}\``

Both are invalid. You may also get a "type instantiation depth exceeded" error which you should be able to solve this problem without hitting.

You should ensure that changes to the filters result in an exact string literal since the purpose is to be able to quickly generate the exact string so you can preview it in the browser.
*/
metric.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29'
);

/**
 * ReplaceAll: Repeatedly replaces all occurrences of `From` in `S` with `To`.
 */
type ReplaceAll<
  S extends string,
  From extends string,
  To extends string
> = S extends `${infer Head}${From}${infer Tail}`
  ? `${ReplaceAll<Head, From, To>}${To}${ReplaceAll<Tail, From, To>}`
  : S;

/**
 * URLEncode: Percent-encode the raw Datadog query string
 */
type URLEncode<S extends string> = ReplaceAll<
  ReplaceAll<
    ReplaceAll<
      ReplaceAll<
        ReplaceAll<
          ReplaceAll<
            S,
            '(', '%28'
          >,
          ')', '%29'
        >,
        ' ', '%20'
      >,
      '@', '%40'
    >,
    ':', '%3A'
  >,
  '>', '%3E'
>;

/**
 * ExtractCondition: Pull out the compiled filter tree from a Metric type
 */
// Pull the Condition *returned* by filter(ctx)
type ExtractCondition<M> =
  M extends { filter: (ctx: any) => infer C }
    ? C
    : never;

/**
 * RenderBasic: Convert a single basic condition into its raw string form
 */
type RenderBasic<C extends { path: string; value: string; negated?: boolean }> =
  `${C['negated'] extends true ? '-' : ''}${C['path']}:${C['value']}`;

/**
 * Join: Recursively join a tuple of strings with a separator
 */
type Join<
  T extends readonly any[],
  Sep extends string
> = T extends [infer Head, ...infer Rest]
  ? Rest['length'] extends 0
    ? RenderCondition<Head>
    : `${RenderCondition<Head>}${Sep}${Join<Rest, Sep>}`
  : '';

/**
 * RenderCondition: Recursively render AND/OR groups and basic conditions
 */
type RenderCondition<C> =
  C extends { type: 'basic'; path: string; value: string }
    ? RenderBasic<C & { type: 'basic' }>
  : C extends { type: 'AND'; conditions: infer A }
    ? A extends readonly [any, ...any[]]
      ? `(${Join<A, ' AND '>})`
      : never
  : C extends { type: 'OR'; conditions: infer O }
    ? O extends readonly [any, ...any[]]
      ? `(${Join<O, ' OR '>})`
      : never
  : never;

/**
 * RawQuery: Build the un-encoded query string from the filter tree
 */
type RawQuery<M> = RenderCondition<ExtractCondition<M>>;

/**
 * EncodedQuery: Percent-encode the raw query string
 */
type EncodedQuery<M> = URLEncode<RawQuery<M>>;

/**
 * GetDatadogLogPreviewResponse: The final URL literal type
 */
type GetDatadogLogPreviewResponse<M extends Metric<any>> =
  `https://app.datadoghq.com/logs?query=${EncodedQuery<M>}`;


// (1) Simple equals on discriminator
const mEqualsOnly = logs.createMetric(apiRequestLog, {
  name: 'only_discriminator',
  compute: { type: 'count' },
  filter: ctx => ctx.equals(ctx.log.discriminator, 'slash.events.api_request'),
});
const previewEqualsOnly = mEqualsOnly.preview(
  'https://app.datadoghq.com/logs?query=%40discriminator%3Aslash.events.api_request'
);

type InferredEqualsOnly = typeof previewEqualsOnly;

// 2) GreaterThan only on duration
const mGtOnly = logs.createMetric(apiRequestLog, {
  name: 'only_duration_gt',
  compute: { type: 'count' },
  filter: ctx => ctx.gt(ctx.log.duration, 100),
});
mGtOnly.preview(
  'https://app.datadoghq.com/logs?query=%40duration%3A%3E100'
);

// 3) Wildcard match on http.route
const mRouteLike = logs.createMetric(apiRequestLog, {
  name: 'route_like',
  compute: { type: 'count' },
  filter: ctx => ctx.like(ctx.log.http.route, '/api/v1/*'),
});
mRouteLike.preview(
  'https://app.datadoghq.com/logs?query=%40http.route%3A/api/v1/*'
);

// 4) Two-way AND (duration >100 AND status_code = 500)
const mDurationStatus = logs.createMetric(apiRequestLog, {
  name: 'slow_and_error',
  compute: { type: 'count' },
  filter: ctx => ctx.and(
    ctx.gt(ctx.log.duration, 100),
    ctx.equals(ctx.log.status_code, 500)
  ),
});
mDurationStatus.preview(
   'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40status_code%3A500%29'
);

// 5) Three-way AND (duration >200, status_code=404, method=GET)
const mThree = logs.createMetric(apiRequestLog, {
  name: 'triple_check',
  compute: { type: 'count' },
  filter: ctx => ctx.and(
    ctx.gt(ctx.log.duration, 200),
    ctx.equals(ctx.log.status_code, 404),
    ctx.equals(ctx.log.http.method, 'GET')
  ),
});
mThree.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E200%20AND%20%40status_code%3A404%20AND%20%40http.method%3AGET%29'
);

// Capture the return value
const previewUrl = metric.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29'
);

// Inspect it in your IDE:
// Hover over `previewUrl` and you should see its type is exactly:
//   "https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29"

type Inferred = typeof previewUrl;

// ───────────────────────────────────────────────────────────────────────────────
// ✨ TESTS START HERE ✨
// ───────────────────────────────────────────────────────────────────────────────

// 0) Original metric (2-clause distribution metric)
const url0 = metric.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29'
);
type T0 = typeof url0;
// Hover T0: 
//   "https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29"

// 1) equals-only metric
const url1 = mEqualsOnly.preview(
  'https://app.datadoghq.com/logs?query=%40discriminator%3Aslash.events.api_request'
);
type T1 = typeof url1; 
// Hover T1: 
//   "https://app.datadoghq.com/logs?query=%40discriminator%3Aslash.events.api_request"

// 2) gt-only metric
const url2 = mGtOnly.preview(
  'https://app.datadoghq.com/logs?query=%40duration%3A%3E100'
);
type T2 = typeof url2;

// 3) wildcard-route metric
const url3 = mRouteLike.preview(
  'https://app.datadoghq.com/logs?query=%40http.route%3A/api/v1/*'
);
type T3 = typeof url3;

// 4) two-way AND (duration & status_code)
const url4 = mDurationStatus.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40status_code%3A500%29'
);
type T4 = typeof url4;

// 5) three-way AND (duration, status_code, method)
const url5 = mThree.preview(
  'https://app.datadoghq.com/logs?query=%28%40duration%3A%3E200%20AND%20%40status_code%3A404%20AND%20%40http.method%3AGET%29'
);
type T5 = typeof url5;

// ───────────────────────────────────────────────────────────────────────────────
// 🔒 Negative tests—these must error if uncommented
// ───────────────────────────────────────────────────────────────────────────────

/*
// @ts-expect-error  un-encoded `@` should be rejected

metric.preview('https://app.datadoghq.com/logs?query=@duration:>100');



// @ts-expect-error  missing leading '%28' on multi-clause should be rejected
mDurationStatus.preview(
  'https://app.datadoghq.com/logs?query=%40duration%3A%3E100%20AND%20%40status_code%3A500%29'
);

*/
// ──


function createLogs() {
  const registeredMetricsOnServerStart = new Map<string, CompiledMetric>();
  return {
    _getMetrics() {
      return registeredMetricsOnServerStart;
    },
    createStructuredLog: <
      const Type extends LogType<any>,
      const Create extends Record<
        `record${string}`,
        (data: any) => Type['$log']
      > = {},
    >(options: {
      type: Type;
      helpers?: Create;
      defaultLogLevel?: 'info' | 'error' | 'warning' | 'debug';
    }): StructuredLog<Type['$log']> &
      CreateLogHelpers<Type extends LogType<infer U> ? U : never, Create> => {
      const helpers = Object.fromEntries(
        Object.entries(options.helpers ?? {}).map(([key, value]) => [
          key,
          (prop) => {
            const info = value(prop);
            console.log({
              ...info,
              type: info.type ?? options.defaultLogLevel ?? 'info',
            } as BaseLogFormat);
          },
        ])
      ) as CreateLogHelpers<Type extends LogType<infer U> ? U : never, Create>;

      return {
        ...helpers,
        record(info) {
          console.log({
            ...info,
            type:
              (info as BaseLogFormat).type ?? options.defaultLogLevel ?? 'info',
          } as BaseLogFormat);
        },
      };
    },
    type<T extends BaseLogFormat>(
      discriminator: T['discriminator']
    ): LogType<T> {
      return {
        discriminator,
      } as LogType<T>;
    },
    preview<M extends Metric<any>>(
        _metric: M,
         _link: GetDatadogLogPreviewResponse<M>
       ): GetDatadogLogPreviewResponse<M> {
          return _link;
       },
    createMetric: <
      Log extends StructuredLog<any>,
      const M extends Metric<Log extends StructuredLog<infer T> ? T : never>,
    >(
      _log: Log,
      metric: M
    ): M & { preview(_link: GetDatadogLogPreviewResponse<M>): GetDatadogLogPreviewResponse<M> } => {
      function logProxy<PathType extends '' | '@'>(
        initialPath: PathType,
        path: string = initialPath
      ): PathBuilder<any, PathType> {
        return new Proxy(
          {},
          {
            get: (_, prop) => {
              if (prop === '$path') {
                return path;
              }

              return logProxy(
                initialPath,
                path !== initialPath
                  ? `${path}.${String(prop)}`
                  : `${initialPath}${String(prop)}`
              );
            },
          }
        );
      }

      const filterContext: FilterContext<any> = {
        and: (...conditions) => ({ type: 'AND', conditions }),
        equals: (p, value) => ({ type: 'basic', path: p.$path, value }),
        notLike: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value,
          negate: true,
        }),
        like: (p, value) => ({ type: 'basic', path: p.$path, value }),
        not: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value,
          negate: true,
        }),
        gt: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value: `>${value}`,
        }),
        gte: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value: `>=${value}`,
        }),
        lt: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value: `<${value}`,
        }),
        lte: (p, value) => ({
          type: 'basic',
          path: p.$path,
          value: `<=${value}`,
        }),
        log: logProxy('@'),
        tags: logProxy(''),
      };

      const filter = metric.filter?.(filterContext);

      const compiledMetric: CompiledMetric = {
        name: metric.name,
        filter,
        compute: (() => {
          switch (metric.compute.type) {
            case 'count':
              return {
                type: 'count',
              };
            case 'distribution':
              return {
                type: 'distribution',
                includePercentiles: metric.compute.includePercentiles,
                path: metric.compute.path({ log: logProxy('@') }).$path,
              };
          }
        })(),
        groupBy: metric.groupBy?.length
          ? metric.groupBy.map((groupBy) => ({
              path: groupBy.path({ log: logProxy('@'), tags: logProxy('') })
                .$path,
              tagName: groupBy?.tagName,
            }))
          : undefined,
      };

      registeredMetricsOnServerStart.set(metric.name, compiledMetric);

      return {
            ...metric,
                preview(link: GetDatadogLogPreviewResponse<M>) {
                  return link;
                },
            };
    },
  };
}

export interface CompiledMetric {
  name: string;
  filter: DatadogLogsCondition | undefined;
  compute:
    | {
        type: 'count';
      }
    | {
        type: 'distribution';
        includePercentiles: boolean;
        path: string;
      };
  groupBy:
    | {
        path: string;
        tagName: string | undefined;
      }[]
    | undefined;
}

export interface BaseLogFormat {
  type?: 'info' | 'error' | 'warning' | 'debug' | undefined;
  discriminator: `slash.events.${string}`;
  message: string;
}

type CreateLogHelpers<
  T,
  Create extends {
    [Key in `record${string}`]: (data: any) => T;
  },
> = {
  [Key in keyof Create]: (
    param: ReturnType<Create[Extract<Key, `record${string}`>]>
  ) => void;
};

interface Metric<T extends BaseLogFormat> {
  name: string;
  compute:
    | {
        type: 'count';
      }
    | {
        type: 'distribution';
        includePercentiles: boolean;
        path: (param: { log: PathBuilder<T> }) => BuiltPath;
      };
  filter?: FilterFn<T>;
  groupBy?: {
    path: (param: {
      log: PathBuilder<T>;
      tags: PathBuilder<Tags, ''>;
    }) => BuiltPath;
    tagName?: string;
  }[];
}

interface BuiltPath<Type = any> {
  $path: string;
  $typescriptType: Type;
  $type: 'built_path';
}

type PathBuilder<
  T,
  PathType extends '' | '@' = '@',
  P extends string = PathType,
> = {
  [Key in keyof T]: T[Key] extends string | boolean | number | undefined | null
    ? {
        $path: P extends PathType
          ? `${P}${Extract<Key, string>}`
          : `${P}.${Extract<Key, string>}`;
        $type: 'built_path';
        $typescriptType: T[Key];
      }
    : PathBuilder<
        T[Key],
        PathType,
        P extends PathType
          ? `${P}${Extract<Key, string>}`
          : `${P}.${Extract<Key, string>}`
      >;
};

interface Tags {
  env: 'production' | 'staging' | 'development';
  hostname: string;
}

interface FilterContext<T extends BaseLogFormat> {
  tags: PathBuilder<Tags, ''>;
  log: PathBuilder<T, '@'>;
  and: <Conditions extends readonly DatadogLogsCondition[]>(
    ...conditions: Conditions
  ) => InstanceOf<
    DatadogLogsCondition,
    { type: 'AND'; conditions: Conditions }
  >;
  equals<P extends BuiltPath, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: `${Value}` }
  >;
  notLike<
    P extends BuiltPath<string>,
    const Value extends P['$typescriptType'],
  >(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: Value; negate: true }
  >;
  like<P extends BuiltPath<string>, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: Value }
  >;
  not<P extends BuiltPath, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: Value; negate: true }
  >;
  gt<P extends BuiltPath<number>, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: `>${Value}` }
  >;
  gte<P extends BuiltPath<number>, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: `>=${Value}` }
  >;
  lt<P extends BuiltPath<number>, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: `<${Value}` }
  >;
  lte<P extends BuiltPath<number>, const Value extends P['$typescriptType']>(
    path: P,
    value: Value
  ): InstanceOf<
    DatadogLogsCondition,
    { type: 'basic'; path: P['$path']; value: `<=${Value}` }
  >;
}

type FilterFn<T extends BaseLogFormat> = (
  ctx: FilterContext<T>
) => DatadogLogsCondition;

export type DatadogLogsCondition =
  | {
      type: 'basic';
      path: string;
      value: string;
      negated?: boolean;
    }
  | {
      type: 'AND' | 'OR';
      conditions: readonly DatadogLogsCondition[];
    };
type InstanceOf<T, C extends T> = C;

export interface StructuredLog<T extends BaseLogFormat> {
  record(info: T): void;
}

interface LogType<T extends BaseLogFormat> {
  discriminator: T['discriminator'];
  $log: T;
}

