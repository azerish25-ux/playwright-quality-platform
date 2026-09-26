import { createHash } from 'node:crypto';
import { ConfigurationError, stableStringify } from '@azerish25-ux/forgeqa-core';
function seedNumber(parts: unknown[]): number { return Number.parseInt(createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0,8),16) >>> 0; }
function generator(seed: number): () => number { let state = seed || 0x6d2b79f5; return () => { state += 0x6d2b79f5; let t=state; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
export interface FactoryContext { seed: string; logicalTestId: string; namespace: string; sequence: number; random: () => number; integer(min:number,max:number):number; pick<T>(values: readonly T[]):T; }
export interface DataFactory<T> { readonly name: string; build(input: { seed:string; logicalTestId:string; namespace:string; sequence?:number }, overrides?: Partial<T>): T; }
export function defineDataFactory<T extends object>(name: string, builder: (context: FactoryContext) => T): DataFactory<T> {
  if (!/^[a-z][a-z0-9-]{2,63}$/i.test(name)) throw new ConfigurationError(`Invalid factory name: ${name}`);
  return Object.freeze({ name, build(input: { seed:string; logicalTestId:string; namespace:string; sequence?:number }, overrides: Partial<T> = {}) { const sequence=input.sequence??0; const random=generator(seedNumber([name,input.seed,input.logicalTestId,sequence])); const context:FactoryContext={ ...input, sequence, random, integer(min,max){ if(!Number.isInteger(min)||!Number.isInteger(max)||min>max) throw new ConfigurationError('Invalid integer range.'); return Math.floor(random()*(max-min+1))+min; }, pick(values){ if(!values.length) throw new ConfigurationError('Cannot pick from an empty collection.'); return values[Math.floor(random()*values.length)]!; } }; return Object.freeze({ ...builder(context), ...overrides }); } });
}
