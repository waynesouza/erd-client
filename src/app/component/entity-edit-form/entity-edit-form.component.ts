import { Component, EventEmitter, Input, Output } from '@angular/core';
import { EntityModel } from '../../model/entity.model';
import { Point } from 'gojs';
import { DataType } from "../../model/enum/datatype.enum";
import { AttributeModel } from '../../model/attribute.model';
@Component({
  selector: 'app-entity-edit-form',
  templateUrl: './entity-edit-form.component.html',
  styleUrls: ['./entity-edit-form.component.scss']
})
export class EntityEditFormComponent {

  @Input() entity: EntityModel = {
    id: '',
    key: '',
    items: [],
    location: new Point(0, 0)
  };
  @Output() entityUpdated: EventEmitter<EntityModel> = new EventEmitter<EntityModel>();
  @Output() entityRemoved: EventEmitter<string> = new EventEmitter<string>();
  @Output() close: EventEmitter<void> = new EventEmitter<void>();
  dataTypes: DataType[] = Object.values(DataType);
  

  addAttribute(): void {
    const newAttribute: AttributeModel = {
      name: '',
      type: DataType.VARCHAR,
      pk: false,
      fk: false,
      unique: false,
      defaultValue: '',
      nullable: true,
      autoIncrement: false
    };
    
    this.entity.items.push(newAttribute);
  }

  removeAttribute(index: number): void {
    if (confirm('Are you sure you want to remove this attribute?')) {
      this.entity.items.splice(index, 1);
    }
  }

  updateEntity(): void {
    this.entityUpdated.emit(this.entity);
    this.closeModal();
  }

  closeModal(): void {
    this.close.emit();
  }

  // Validação automática quando o usuário seleciona Primary Key
  onPrimaryKeyChange(attribute: AttributeModel): void {
    if (attribute.pk) {
      // Desmarcar outras PKs (apenas uma PK permitida)
      this.entity.items.forEach(attr => {
        if (attr !== attribute) {
          attr.pk = false;
        }
      });
      
      // PK deve ser NOT NULL
      attribute.nullable = false;
    }
  }

  // Validação automática quando o usuário seleciona AUTO_INCREMENT
  onAutoIncrementChange(attribute: AttributeModel): void {
    if (attribute.autoIncrement) {
      // Desmarcar outros AUTO_INCREMENT (apenas um permitido)
      this.entity.items.forEach(attr => {
        if (attr !== attribute) {
          attr.autoIncrement = false;
        }
      });
      
      // AUTO_INCREMENT deve ser NOT NULL
      attribute.nullable = false;
      
      // AUTO_INCREMENT deve ser INTEGER ou BIGINT
      if (attribute.type !== DataType.INTEGER && attribute.type !== DataType.BIGINT) {
        attribute.type = DataType.INTEGER;
      }
      
      // AUTO_INCREMENT geralmente é PK
      if (!attribute.pk && !attribute.unique) {
        attribute.pk = true;
        this.onPrimaryKeyChange(attribute);
      }
    }
  }

  // Validação de nome de atributo em tempo real
  validateAttributeName(attribute: AttributeModel): boolean {
    if (!attribute.name || attribute.name.trim() === '') {
      return false;
    }

    const attrName = attribute.name.trim();
    
    // Verificar caracteres válidos
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(attrName)) {
      return false;
    }

    // Verificar duplicatas
    const duplicates = this.entity.items.filter(attr => 
      attr !== attribute && 
      attr.name && 
      attr.name.toLowerCase() === attrName.toLowerCase()
    );

    return duplicates.length === 0;
  }

  // Validação de nome de entidade em tempo real
  validateEntityName(): boolean {
    if (!this.entity.key || this.entity.key.trim() === '') {
      return false;
    }

    const entityName = this.entity.key.trim();
    
    // Verificar caracteres válidos
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(entityName)) {
      return false;
    }

    return entityName.length >= 2 && entityName.length <= 64;
  }

  // Verificar se há pelo menos uma PK
  hasPrimaryKey(): boolean {
    return this.entity.items.some(attr => attr.pk);
  }

  // Obter mensagem de erro para atributo
  getAttributeError(attribute: AttributeModel): string {
    if (!this.validateAttributeName(attribute)) {
      if (!attribute.name || attribute.name.trim() === '') {
        return 'Name is required';
      }
      
      const attrName = attribute.name.trim();
      
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(attrName)) {
        return 'Must start with letter, use only letters, numbers, underscores';
      }

      const duplicates = this.entity.items.filter(attr => 
        attr !== attribute && 
        attr.name && 
        attr.name.toLowerCase() === attrName.toLowerCase()
      );

      if (duplicates.length > 0) {
        return 'Duplicate name';
      }
    }
    
    return '';
  }

}
