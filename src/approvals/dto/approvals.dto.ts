import { IsIn, IsOptional, IsString } from 'class-validator';

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
