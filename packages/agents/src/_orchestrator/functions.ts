import { migrateRepository } from './migrate-repository.js';
import { refactorRepository } from './refactor-repository.js';
import { securityAuditRepository } from './security-audit-repository.js';
import { qaRepository } from './qa-repository.js';

export const functions = [migrateRepository, refactorRepository, securityAuditRepository, qaRepository];
