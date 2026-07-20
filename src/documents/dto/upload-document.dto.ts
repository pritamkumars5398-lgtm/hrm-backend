import { IsIn, IsString, MinLength } from 'class-validator';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '../document.entity';

export class UploadDocumentDto {
  @IsString()
  @MinLength(1, { message: 'Please enter a document name.' })
  name!: string;

  @IsString()
  @MinLength(1, { message: 'Please enter a description.' })
  description!: string;

  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;
}
