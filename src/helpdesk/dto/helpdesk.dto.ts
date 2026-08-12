import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CATEGORIES = ['HR', 'IT', 'Finance', 'Admin'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty({ message: 'Subject is required.' })
  subject!: string;

  @IsString()
  @IsNotEmpty({ message: 'Description is required.' })
  description!: string;

  @IsIn(CATEGORIES, { message: 'Invalid ticket category.' })
  category!: 'HR' | 'IT' | 'Finance' | 'Admin';

  @IsIn(PRIORITIES, { message: 'Invalid ticket priority.' })
  priority!: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export class UpdateTicketStatusDto {
  @IsIn(STATUSES, { message: 'Invalid ticket status.' })
  status!: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsString()
  @IsOptional()
  assignedToId?: string;

  @IsString()
  @IsOptional()
  resolution?: string;
}

export class AddCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'Comment text is required.' })
  comment!: string;
}
