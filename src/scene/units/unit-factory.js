import { UNIT_DEFINITIONS } from '../../core/unit-definitions.js';
import { SandUnit } from './base-unit.js';
import { KnightUnit } from './knight-unit.js';
import { GargoyleUnit } from './gargoyle-unit.js';

export function createUnit(type, context, options = {}) {
  if (type === 'kesatria') return new KnightUnit(context, 'kesatria', options);
  if (type === 'gargoyle') return new GargoyleUnit(context, options);
  if (UNIT_DEFINITIONS[type]) return new SandUnit(context, type, options);
  throw new Error(`Unknown unit type: ${type}`);
}
