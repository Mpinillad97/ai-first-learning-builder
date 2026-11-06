export interface EnvConfig {
  port: number;
}

const DEFAULT_PORT = 3001;

function parsePort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

export const env: EnvConfig = {
  port: parsePort(process.env.PORT),
};
