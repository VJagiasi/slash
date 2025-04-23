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
metric.preview('https://app.datadoghq.com/logs?query=%28%40duration%3A%3E100%20AND%20%40discriminator%3Aslash.events.api_request%29');


type GetDatadogLogPreviewResponse<M extends Metric<any>> = '';


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
    ) {},
    createMetric: <
      Log extends StructuredLog<any>,
      const M extends Metric<Log extends StructuredLog<infer T> ? T : never>,
    >(
      _log: Log,
      metric: M
    ): M & { preview(_link: GetDatadogLogPreviewResponse<M>): void } => {
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

      return { ...metric, preview() {} };
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
