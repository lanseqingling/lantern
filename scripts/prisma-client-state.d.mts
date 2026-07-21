export function prismaSchemaState(repositoryRoot: string): string;
export function generatedPrismaSchemaMatches(repositoryRoot: string): boolean;
export function prismaClientReady(repositoryRoot: string, expectedState?: string): boolean;
export function recordPrismaClientState(repositoryRoot: string, state?: string): void;
