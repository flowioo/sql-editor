export type ConnectionType = "sqlite" | "postgresql" | "mysql";

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
}

export interface MysqlConfig {
  readonly type: "mysql";
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export type ConnectionConfig = SqliteConfig | PostgresqlConfig | MysqlConfig;
