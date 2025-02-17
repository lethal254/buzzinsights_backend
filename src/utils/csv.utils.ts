import { parse } from 'csv-parse';
import { Readable } from 'stream';

export interface CategoryCSVRow {
  name: string;
  description?: string;
  keywords?: string;
  versions?: string; // Only for product categories
  userId?: string;
  orgId?: string;
}

export class CSVUtils {
  static async parseCategoryCSV(
    fileBuffer: Buffer,
    includeVersions: boolean = false
  ): Promise<{ valid: CategoryCSVRow[]; invalid: { row: any; errors: string[] }[] }> {
    const valid: CategoryCSVRow[] = [];
    const invalid: { row: any; errors: string[] }[] = [];

    return new Promise((resolve, reject) => {
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const stream = Readable.from(fileBuffer);

      const rows: any[] = [];
      stream
        .pipe(parser)
        .on('data', (row) => rows.push(row))
        .on('end', () => {
          rows.forEach((row) => {
            const errors: string[] = [];

            // Validate required fields
            if (!row.name) {
              errors.push('Name is required');
            }

            if (!row.userId && !row.orgId) {
              errors.push('Either userId or orgId is required');
            }

            // Process keywords
            if (row.keywords) {
              try {
                row.keywords = row.keywords
                  .split(',')
                  .map((k: string) => k.trim())
                  .filter((k: string) => k);
              } catch {
                errors.push('Keywords must be comma-separated values');
              }
            } else {
              row.keywords = [];
            }

            // Process versions for product categories
            if (includeVersions && row.versions) {
              try {
                row.versions = row.versions
                  .split(',')
                  .map((v: string) => v.trim())
                  .filter((v: string) => v);
              } catch {
                errors.push('Versions must be comma-separated values');
              }
            } else if (includeVersions) {
              row.versions = [];
            }

            // Clean up fields
            const cleanRow: CategoryCSVRow = {
              name: row.name?.trim(),
              description: row.description?.trim() || undefined,
              keywords: row.keywords,
              ...(includeVersions && { versions: row.versions }),
              userId: row.userId?.trim() || undefined,
              orgId: row.orgId?.trim() || undefined,
            };

            if (errors.length > 0) {
              invalid.push({ row: cleanRow, errors });
            } else {
              valid.push(cleanRow);
            }
          });

          resolve({ valid, invalid });
        })
        .on('error', reject);
    });
  }
}
