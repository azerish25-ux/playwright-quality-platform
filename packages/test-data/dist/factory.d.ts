export interface FactoryContext {
    seed: string;
    logicalTestId: string;
    namespace: string;
    sequence: number;
    random: () => number;
    integer(min: number, max: number): number;
    pick<T>(values: readonly T[]): T;
}
export interface DataFactory<T> {
    readonly name: string;
    build(input: {
        seed: string;
        logicalTestId: string;
        namespace: string;
        sequence?: number;
    }, overrides?: Partial<T>): T;
}
export declare function defineDataFactory<T extends object>(name: string, builder: (context: FactoryContext) => T): DataFactory<T>;
//# sourceMappingURL=factory.d.ts.map