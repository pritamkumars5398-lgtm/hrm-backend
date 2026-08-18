import { BadRequestException } from '@nestjs/common';

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

export interface PaginateOptions {
  where: any;
  limit?: number | string;
  cursor?: string;
  sortField: string;
  sortDirection?: 'asc' | 'desc';
  organizationId: string;
  defaultLimit?: number;
  maxLimit?: number;
  select?: any;
}

/**
 * Executes a cursor-based pagination query on a Prisma model.
 * Enforces organization-scoping boundaries inside the cursor.
 */
export async function paginate<T>(
  prismaModel: any,
  options: PaginateOptions,
): Promise<PaginatedResult<T>> {
  const defaultLimit = options.defaultLimit ?? 25;
  const maxLimit = options.maxLimit ?? 100;
  let limit = defaultLimit;

  if (options.limit !== undefined && options.limit !== null) {
    limit = typeof options.limit === 'number' ? options.limit : parseInt(options.limit, 10);
    if (isNaN(limit) || limit <= 0) {
      throw new BadRequestException('Invalid limit parameter.');
    }
    if (limit > maxLimit) {
      limit = maxLimit;
    }
  }

  const sortField = options.sortField;
  const sortDirection = options.sortDirection ?? 'asc';
  const isDesc = sortDirection === 'desc';

  let cursorData: { sortValue: any; id: string } | null = null;
  if (options.cursor) {
    try {
      const decoded = Buffer.from(options.cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed.organizationId !== options.organizationId) {
        throw new BadRequestException('Invalid cursor context.');
      }
      cursorData = {
        sortValue: parsed.sortValue,
        id: parsed.id,
      };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('Malformed cursor.');
    }
  }

  // Build the cursor-based comparison where clause
  let cursorCondition: any = null;
  if (cursorData) {
    const operator = isDesc ? 'lt' : 'gt';
    
    // Parse sort value if it was serialized from a Date object
    let cursorSortValue = cursorData.sortValue;
    if (typeof cursorSortValue === 'string' && !isNaN(Date.parse(cursorSortValue))) {
      const date = new Date(cursorSortValue);
      if (date.toISOString() === cursorSortValue) {
        cursorSortValue = date;
      }
    }

    cursorCondition = {
      OR: [
        {
          [sortField]: { [operator]: cursorSortValue },
        },
        {
          [sortField]: cursorSortValue,
          id: { [operator]: cursorData.id },
        },
      ],
    };
  }

  // Combine standard organization-scoping and filters with the cursor condition
  const queryWhere = {
    AND: [
      options.where,
      cursorCondition,
    ].filter(Boolean),
  };



  // Fetch limit + 1 records using take to determine hasNextPage
  const records = await prismaModel.findMany({
    where: queryWhere,
    take: limit + 1,
    orderBy: [
      { [sortField]: sortDirection },
      { id: sortDirection },
    ],
    ...(options.select ? { select: options.select } : {}),
  });



  const hasNextPage = records.length > limit;
  const data = records.slice(0, limit);

  let nextCursor: string | null = null;
  if (hasNextPage && data.length > 0) {
    const lastRecord = data[data.length - 1];
    let sortValue = lastRecord[sortField];
    if (sortValue instanceof Date) {
      sortValue = sortValue.toISOString();
    }
    nextCursor = Buffer.from(
      JSON.stringify({
        sortValue,
        id: lastRecord.id,
        organizationId: options.organizationId,
      }),
      'utf8',
    ).toString('base64url');
  }

  return {
    data,
    pagination: {
      limit,
      nextCursor,
      hasNextPage,
    },
  };
}
