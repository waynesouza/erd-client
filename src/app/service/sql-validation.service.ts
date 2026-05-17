import { Injectable } from '@angular/core';
import { EntityModel } from '../model/entity.model';
import { AttributeModel } from '../model/attribute.model';
import { DataType } from '../model/enum/datatype.enum';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable({
  providedIn: 'root'
})
export class SqlValidationService {

  constructor() { }

  /** Validates a single entity. */
  validateEntity(entity: EntityModel, allEntities: EntityModel[] = []): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // 1. Validate entity name
    this.validateEntityName(entity, allEntities, result);

    // 2. Validate minimum attributes
    this.validateMinimumAttributes(entity, result);

    // 3. Validate Primary Key
    this.validatePrimaryKey(entity, result);

    // 4. Validate attribute names
    this.validateAttributeNames(entity, result);

    // 5. Validate data types
    this.validateDataTypes(entity, result);

    // 6. Validate type-specific rules
    this.validateTypeSpecificRules(entity, result);

    // 7. Validate AUTO_INCREMENT
    this.validateAutoIncrement(entity, result);

    // 8. Validate UNIQUE constraints
    this.validateUniqueConstraints(entity, result);

    result.isValid = result.errors.length === 0;
    return result;
  }

  /** Validates the full diagram. */
  validateDiagram(entities: EntityModel[]): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // 1. Validate unique entity names
    this.validateUniqueEntityNames(entities, result);

    // 2. Validate each entity individually
    entities.forEach((entity, index) => {
      const entityResult = this.validateEntity(entity, entities);

      // Prefix errors with entity name
      entityResult.errors.forEach(error => {
        result.errors.push(`[${entity.key || `Entity ${index + 1}`}] ${error}`);
      });

      entityResult.warnings.forEach(warning => {
        result.warnings.push(`[${entity.key || `Entity ${index + 1}`}] ${warning}`);
      });
    });

    // 3. Validate relationships
    this.validateRelationships(entities, result);

    result.isValid = result.errors.length === 0;
    return result;
  }

  private validateEntityName(entity: EntityModel, allEntities: EntityModel[], result: ValidationResult): void {
    // Required
    if (!entity.key || entity.key.trim() === '') {
      result.errors.push('Entity name is required');
      return;
    }

    const entityName = entity.key.trim();

    // Validate SQL-valid characters
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(entityName)) {
      result.errors.push('Entity name must start with a letter and contain only letters, numbers, and underscores');
    }

    // Name length
    if (entityName.length > 64) {
      result.errors.push('Entity name must be 64 characters or less');
    }

    if (entityName.length < 2) {
      result.errors.push('Entity name must be at least 2 characters long');
    }

    // SQL reserved words
    const reservedWords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
      'TABLE', 'INDEX', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'DATABASE', 'SCHEMA',
      'PRIMARY', 'FOREIGN', 'KEY', 'CONSTRAINT', 'UNIQUE', 'NOT', 'NULL', 'DEFAULT',
      'ORDER', 'BY', 'GROUP', 'HAVING', 'UNION', 'JOIN', 'INNER', 'OUTER', 'LEFT', 'RIGHT',
      'USER', 'ROLE', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'TRANSACTION'
    ];

    if (reservedWords.includes(entityName.toUpperCase())) {
      result.errors.push(`"${entityName}" is a reserved SQL keyword and cannot be used as entity name`);
    }

    // Check for duplicate names
    const duplicates = allEntities.filter(e =>
      e.id !== entity.id &&
      e.key &&
      e.key.toLowerCase() === entityName.toLowerCase()
    );

    if (duplicates.length > 0) {
      result.errors.push(`Entity name "${entityName}" is already used by another entity`);
    }
  }

  private validateMinimumAttributes(entity: EntityModel, result: ValidationResult): void {
    if (!entity.items || entity.items.length === 0) {
      result.errors.push('Entity must have at least one attribute');
    }
  }

  private validatePrimaryKey(entity: EntityModel, result: ValidationResult): void {
    const primaryKeys = entity.items.filter(attr => attr.pk);

    if (primaryKeys.length === 0) {
      result.errors.push('Entity must have exactly one Primary Key');
    } else if (primaryKeys.length > 1) {
      result.errors.push('Entity can have only one Primary Key (use composite keys if needed)');
    }

    // PK cannot be nullable
    primaryKeys.forEach(pk => {
      if (pk.nullable) {
        result.errors.push(`Primary Key "${pk.name}" cannot be nullable`);
      }
    });
  }

  private validateAttributeNames(entity: EntityModel, result: ValidationResult): void {
    const attributeNames = new Set<string>();

    entity.items.forEach((attr, index) => {
      // Required
      if (!attr.name || attr.name.trim() === '') {
        result.errors.push(`Attribute at position ${index + 1} must have a name`);
        return;
      }

      const attrName = attr.name.trim();

      // Validate SQL-valid characters
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(attrName)) {
        result.errors.push(`Attribute "${attrName}" must start with a letter and contain only letters, numbers, and underscores`);
      }

      // Name length
      if (attrName.length > 64) {
        result.errors.push(`Attribute "${attrName}" name must be 64 characters or less`);
      }

      // Duplicate names
      const lowerName = attrName.toLowerCase();
      if (attributeNames.has(lowerName)) {
        result.errors.push(`Duplicate attribute name: "${attrName}"`);
      }
      attributeNames.add(lowerName);

      // Common system column names
      const reservedColumnNames = ['id', 'created_at', 'updated_at', 'deleted_at'];
      if (reservedColumnNames.includes(lowerName) && !attr.pk) {
        result.warnings.push(`"${attrName}" is commonly used as a system column name`);
      }
    });
  }

  private validateDataTypes(entity: EntityModel, result: ValidationResult): void {
    entity.items.forEach(attr => {
      if (!attr.type) {
        result.errors.push(`Attribute "${attr.name}" must have a data type`);
        return;
      }

      // Type-specific validations
      this.validateSpecificDataType(attr, result);
    });
  }

  private validateSpecificDataType(attr: AttributeModel, result: ValidationResult): void {
    const attrName = attr.name || 'unnamed attribute';

    switch (attr.type) {
      case DataType.INTEGER:
      case DataType.BIGINT:
        // Numeric types should not have non-numeric default values
        if (attr.defaultValue && attr.defaultValue.trim() !== '' && isNaN(Number(attr.defaultValue))) {
          result.errors.push(`${attrName} with ${attr.type} type has invalid default value: "${attr.defaultValue}"`);
        }
        break;

      case DataType.DECIMAL:
      case DataType.NUMERIC:
        if (attr.defaultValue && attr.defaultValue.trim() !== '' && isNaN(Number(attr.defaultValue))) {
          result.errors.push(`${attrName} with ${attr.type} type has invalid default value: "${attr.defaultValue}"`);
        }
        break;

      case DataType.BOOLEAN:
        if (attr.defaultValue && attr.defaultValue.trim() !== '') {
          const validBooleans = ['true', 'false', '1', '0', 'TRUE', 'FALSE'];
          if (!validBooleans.includes(attr.defaultValue.trim())) {
            result.errors.push(`${attrName} with BOOLEAN type has invalid default value: "${attr.defaultValue}". Use: true, false, 1, or 0`);
          }
        }
        break;

      case DataType.DATE:
      case DataType.TIMESTAMP:
      case DataType.TIME:
        if (attr.defaultValue && attr.defaultValue.trim() !== '') {
          const validDateDefaults = ['CURRENT_TIMESTAMP', 'NOW()', 'CURRENT_DATE'];
          if (!validDateDefaults.includes(attr.defaultValue.toUpperCase()) &&
              !this.isValidDateFormat(attr.defaultValue)) {
            result.warnings.push(`${attrName} has potentially invalid date default value: "${attr.defaultValue}"`);
          }
        }
        break;
    }
  }

  private validateTypeSpecificRules(entity: EntityModel, result: ValidationResult): void {
    entity.items.forEach(attr => {
      const attrName = attr.name || 'unnamed attribute';

      // AUTO_INCREMENT is only valid for integer types
      if (attr.autoIncrement) {
        const validAutoIncrementTypes = [DataType.INTEGER, DataType.BIGINT];
        if (!validAutoIncrementTypes.includes(attr.type as DataType)) {
          result.errors.push(`${attrName} with AUTO_INCREMENT must be INTEGER or BIGINT`);
        }

        // AUTO_INCREMENT must be PRIMARY KEY or UNIQUE
        if (!attr.pk && !attr.unique) {
          result.errors.push(`${attrName} with AUTO_INCREMENT should be PRIMARY KEY or UNIQUE`);
        }

        // AUTO_INCREMENT cannot be nullable
        if (attr.nullable) {
          result.errors.push(`${attrName} with AUTO_INCREMENT cannot be nullable`);
        }
      }

      // UNIQUE + nullable is a likely design mistake
      if (attr.unique && attr.nullable) {
        result.warnings.push(`${attrName} is UNIQUE but nullable - consider making it NOT NULL for better performance`);
      }
    });
  }

  private validateAutoIncrement(entity: EntityModel, result: ValidationResult): void {
    const autoIncrementCols = entity.items.filter(attr => attr.autoIncrement);

    if (autoIncrementCols.length > 1) {
      result.errors.push('Entity can have only one AUTO_INCREMENT column');
    }
  }

  private validateUniqueConstraints(entity: EntityModel, result: ValidationResult): void {
    // Warn when there are too many UNIQUE constraints (performance concern)
    const uniqueCols = entity.items.filter(attr => attr.unique);

    if (uniqueCols.length > 5) {
      result.warnings.push(`Entity has ${uniqueCols.length} UNIQUE constraints - consider if all are necessary for performance`);
    }
  }

  private validateUniqueEntityNames(entities: EntityModel[], result: ValidationResult): void {
    const entityNames = new Map<string, EntityModel[]>();

    entities.forEach(entity => {
      if (entity.key && entity.key.trim() !== '') {
        const lowerName = entity.key.toLowerCase();
        if (!entityNames.has(lowerName)) {
          entityNames.set(lowerName, []);
        }
        entityNames.get(lowerName)!.push(entity);
      }
    });

    entityNames.forEach((entitiesWithSameName, name) => {
      if (entitiesWithSameName.length > 1) {
        result.errors.push(`Duplicate entity name: "${name}" is used by ${entitiesWithSameName.length} entities`);
      }
    });
  }

  private validateRelationships(entities: EntityModel[], result: ValidationResult): void {
    // Validate that foreign key column names follow the _id naming convention
    entities.forEach(entity => {
      entity.items.filter(attr => attr.fk).forEach(fkAttr => {
        if (!fkAttr.name.endsWith('_id')) {
          result.warnings.push(`Foreign key "${fkAttr.name}" in entity "${entity.key}" should typically end with "_id"`);
        }
      });
    });
  }

  private isValidDateFormat(dateString: string): boolean {
    // Simple date format validation
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}$/,                    // YYYY-MM-DD
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/  // YYYY-MM-DD HH:MM:SS
    ];

    return datePatterns.some(pattern => pattern.test(dateString));
  }

  /** Formats validation errors and warnings for display. */
  formatValidationMessages(result: ValidationResult): string {
    let message = '';

    if (result.errors.length > 0) {
      message += '❌ ERRORS:\n';
      result.errors.forEach((error, index) => {
        message += `${index + 1}. ${error}\n`;
      });
    }

    if (result.warnings.length > 0) {
      message += result.errors.length > 0 ? '\n' : '';
      message += '⚠️ WARNINGS:\n';
      result.warnings.forEach((warning, index) => {
        message += `${index + 1}. ${warning}\n`;
      });
    }

    return message;
  }

}
