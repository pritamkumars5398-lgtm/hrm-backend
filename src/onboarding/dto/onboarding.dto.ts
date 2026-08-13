import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AddTaskDto {
  @IsString()
  @MinLength(1, { message: 'Task title is required.' })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(['HR', 'IT', 'MANAGER', 'EMPLOYEE'], { message: 'Invalid category.' })
  category!: 'HR' | 'IT' | 'MANAGER' | 'EMPLOYEE';

  @IsString()
  @IsOptional()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsIn(['PENDING', 'COMPLETED'], { message: 'Invalid status.' })
  status!: 'PENDING' | 'COMPLETED';
}
