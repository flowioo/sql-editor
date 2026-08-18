export type ConnectionType = "sqlite" | "postgresql" | "mysql" | "redis";

export interface SqliteConfig {
  readonly type: "sqlite";
  readonly path: string;
}

export interface PostgresqlConfig {
  readonly type: "postgresql";
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly url?: string;
}

export interface MysqlConfig {
  readonly type: "mysql";
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly url?: string;
}

export interface RedisConfig {
  readonly type: "redis";
  readonly host: string;
  readonly port: number;
  readonly password: string;
  /** Logical database index (SELECT n), 0 by default. */
  readonly database: number;
}

export type ConnectionConfig = SqliteConfig | PostgresqlConfig | MysqlConfig | RedisConfig;
