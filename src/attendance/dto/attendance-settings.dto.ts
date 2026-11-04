import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateAttendanceSettingsDto {
  @IsBoolean()
  geofenceEnabled!: boolean;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  officeLatitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  officeLongitude?: number;

  // 20m is about the floor GPS can honestly resolve; 50km is "a whole city".
  @IsInt()
  @Min(20, { message: 'Radius must be at least 20 metres.' })
  @Max(50000, { message: 'Radius can be at most 50 km.' })
  @IsOptional()
  geofenceRadiusMeters?: number;
}

/** Optional on purpose — when no geofence is configured the browser needn't share location. */
export class PunchDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  longitude?: number;

  /** Browser-reported GPS accuracy in metres. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  accuracy?: number;
}
