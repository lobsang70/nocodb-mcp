import axios, { AxiosInstance, AxiosError } from "axios";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import { ColumnUpdate, columnUpdateSchema } from "./column-update.js";
import {
  NocoDBConfig,
  NocoDBBase,
  NocoDBTable,
  NocoDBColumn,
  NocoDBRecord,
  NocoDBView,
  QueryOptions,
  AggregateOptions,
  BulkInsertOptions,
} from "./types.js";

export class NocoDBError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any,
  ) {
    super(message);
    this.name = "NocoDBError";
  }
}

export class NocoDBClient {
  private client: AxiosInstance;
  private config: NocoDBConfig;

  constructor(config: NocoDBConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiToken && { "xc-token": config.apiToken }),
        ...(config.authToken && { "xc-auth": config.authToken }),
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const data = error.response?.data as any;
        const message = data?.msg || data?.message || error.message;
        throw new NocoDBError(
          message,
          error.response?.status,
          error.response?.data,
        );
      },
    );
  }

  // Base/Project operations
  async listBases(): Promise<NocoDBBase[]> {
    const response = await this.client.get("/api/v1/db/meta/projects");
    return response.data.list;
  }

  async getBase(baseId: string): Promise<NocoDBBase> {
    const response = await this.client.get(
      `/api/v1/db/meta/projects/${baseId}`,
    );
    return response.data;
  }

  // Table operations
  async listTables(baseId: string): Promise<NocoDBTable[]> {
    const response = await this.client.get(
      `/api/v1/db/meta/projects/${baseId}/tables`,
    );
    return response.data.list;
  }

  async getTable(tableId: string): Promise<NocoDBTable> {
    const response = await this.client.get(`/api/v1/db/meta/tables/${tableId}`);
    return response.data;
  }

  async createTable(
    baseId: string,
    tableName: string,
    columns: any[],
  ): Promise<NocoDBTable> {
    const response = await this.client.post(
      `/api/v1/db/meta/projects/${baseId}/tables`,
      {
        table_name: tableName,
        title: tableName,
        columns: columns,
      },
    );
    return response.data;
  }

  async deleteTable(tableId: string): Promise<void> {
    await this.client.delete(`/api/v1/db/meta/tables/${tableId}`);
  }

  // Column operations
  async listColumns(tableId: string): Promise<NocoDBColumn[]> {
    // Get columns from table info since dedicated columns endpoint doesn't exist
    const response = await this.client.get(`/api/v1/db/meta/tables/${tableId}`);
    return response.data.columns || [];
  }

  async addColumn(
    tableId: string,
    columnDefinition: any,
  ): Promise<NocoDBColumn> {
    const response = await this.client.post(
      `/api/v2/meta/tables/${tableId}/columns`,
      columnDefinition,
    );
    // The API returns the whole table object with columns,
    // so we need to find the newly added column
    const tableData = response.data;
    if (tableData.columns) {
      // Find the column that matches our title or column_name
      const newColumn = tableData.columns.find(
        (col: any) =>
          col.title === columnDefinition.title ||
          col.column_name === columnDefinition.column_name,
      );
      if (newColumn) {
        return newColumn;
      }
    }
    // Fallback to returning the whole response if we can't find the column
    return response.data;
  }

  async deleteColumn(columnId: string): Promise<void> {
    await this.client.delete(`/api/v2/meta/columns/${columnId}`);
  }

  async updateColumn(
    columnId: string,
    updates: ColumnUpdate,
  ): Promise<NocoDBColumn> {
    if (typeof columnId !== "string" || !columnId.trim()) {
      throw new NocoDBError("column_id must be a non-empty string");
    }
    const payload = columnUpdateSchema.parse(updates);
    const endpoint = `/api/v2/meta/columns/${encodeURIComponent(columnId)}`;
    const response = await this.client.patch(endpoint, payload);
    // NocoDB versions may return either the column or its parent table.
    const column =
      (Array.isArray(response.data?.columns)
        ? response.data.columns.find(
            (candidate: NocoDBColumn) => candidate.id === columnId,
          )
        : undefined) ??
      (response.data?.id === columnId ? response.data : undefined);
    if (column) return column;
    // Some versions return only an acknowledgement; read the updated field.
    const updatedColumn = (await this.client.get(endpoint)).data;
    if (updatedColumn?.id !== columnId) {
      throw new NocoDBError("Could not read the updated column");
    }
    return updatedColumn;
  }

  // Record operations
  async createRecord(
    baseId: string,
    tableName: string,
    data: NocoDBRecord,
  ): Promise<NocoDBRecord> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    const response = await this.client.post(
      `/api/v2/tables/${table.id}/records`,
      data,
    );
    return response.data;
  }

  async bulkInsert(
    baseId: string,
    tableName: string,
    options: BulkInsertOptions,
  ): Promise<NocoDBRecord[]> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    const response = await this.client.post(
      `/api/v2/tables/${table.id}/records`,
      options.records,
    );
    return response.data;
  }

  async getRecord(
    baseId: string,
    tableName: string,
    recordId: string,
  ): Promise<NocoDBRecord> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    const response = await this.client.get(
      `/api/v2/tables/${table.id}/records/${recordId}`,
    );
    return response.data;
  }

  async listRecords(
    baseId: string,
    tableName: string,
    options?: QueryOptions,
  ): Promise<{ list: NocoDBRecord[]; pageInfo: any }> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    return this.getRecordPage(table.id, options);
  }

  private async getRecordPage(
    tableId: string,
    options?: QueryOptions,
  ): Promise<{ list: NocoDBRecord[]; pageInfo: any }> {
    const params = new URLSearchParams();

    if (options?.where) params.append("where", options.where);
    if (options?.sort) {
      const sortStr = Array.isArray(options.sort)
        ? options.sort.join(",")
        : options.sort;
      params.append("sort", sortStr);
    }
    if (options?.fields) {
      const fieldsStr = Array.isArray(options.fields)
        ? options.fields.join(",")
        : options.fields;
      params.append("fields", fieldsStr);
    }
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());
    if (options?.viewId) params.append("viewId", options.viewId);

    const response = await this.client.get(
      `/api/v2/tables/${tableId}/records?${params.toString()}`,
    );
    return response.data;
  }

  private async *recordPages(
    baseId: string,
    tableName: string,
    options?: Pick<QueryOptions, "where" | "fields" | "viewId" | "sort">,
  ): AsyncGenerator<NocoDBRecord[]> {
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) throw new NocoDBError(`Table ${tableName} not found`);
    let offset = 0;
    let previousPage: number | undefined;
    while (true) {
      const page = await this.getRecordPage(table.id, {
        ...options,
        limit: 100,
        offset,
      });
      if (!Array.isArray(page.list))
        throw new NocoDBError("Invalid record page response");
      if (page.list.length === 0) {
        if (page.pageInfo?.isLastPage === false) {
          throw new NocoDBError("Empty record page reports more results");
        }
        return;
      }
      const pageNumber = page.pageInfo?.page;
      if (typeof pageNumber === "number") {
        if (previousPage !== undefined && pageNumber <= previousPage) {
          throw new NocoDBError("Record pagination did not advance");
        }
        previousPage = pageNumber;
      }
      yield page.list;
      if (page.pageInfo?.isLastPage === true) return;
      // Advance by the actual response size: servers may cap the requested limit.
      offset += page.list.length;
    }
  }

  private resultWindow(options?: QueryOptions, defaultLimit?: number) {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? defaultLimit;
    for (const [name, value] of [
      ["offset", offset],
      ["limit", limit],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new NocoDBError(`${name} must be a non-negative integer`);
      }
    }
    return { offset, limit };
  }

  async updateRecord(
    baseId: string,
    tableName: string,
    recordId: string,
    data: NocoDBRecord,
  ): Promise<NocoDBRecord> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    // Get the primary key field name (usually ID but can vary)
    const columns = await this.listColumns(table.id);
    const pkColumn =
      columns.find((col) => col.pk) ||
      columns.find((col) => col.title === "ID");
    const pkField = pkColumn?.title || "ID";

    const response = await this.client.patch(
      `/api/v2/tables/${table.id}/records`,
      {
        [pkField]: recordId,
        ...data,
      },
    );
    return response.data;
  }

  async deleteRecord(
    baseId: string,
    tableName: string,
    recordId: string,
  ): Promise<void> {
    // First get table ID from table name
    const tables = await this.listTables(baseId);
    const table = tables.find(
      (t) => t.table_name === tableName || t.title === tableName,
    );
    if (!table) {
      throw new NocoDBError(`Table ${tableName} not found`);
    }

    // Get the primary key field name (usually ID but can vary)
    const columns = await this.listColumns(table.id);
    const pkColumn =
      columns.find((col) => col.pk) ||
      columns.find((col) => col.title === "ID");
    const pkField = pkColumn?.title || "ID";

    await this.client.delete(`/api/v2/tables/${table.id}/records`, {
      data: { [pkField]: recordId },
    });
  }

  // View operations
  async listViews(tableId: string): Promise<NocoDBView[]> {
    const response = await this.client.get(
      `/api/v2/meta/tables/${tableId}/views`,
    );
    return response.data.list || [];
  }

  async createView(
    tableId: string,
    title: string,
    type: number = 1,
  ): Promise<NocoDBView> {
    const response = await this.client.post(
      `/api/v2/meta/tables/${tableId}/views`,
      {
        title,
        type,
      },
    );
    return response.data;
  }

  // Search operation
  async searchRecords(
    baseId: string,
    tableName: string,
    query: string,
    options?: QueryOptions,
  ): Promise<{ list: NocoDBRecord[]; pageInfo: any }> {
    const { offset, limit } = this.resultWindow(options, 25);
    const list: NocoDBRecord[] = [];
    let totalRows = 0;
    for await (const records of this.recordPages(baseId, tableName, {
      where: options?.where,
      fields: options?.fields,
      viewId: options?.viewId,
      sort: options?.sort,
    })) {
      for (const record of records) {
        if (
          !Object.values(record).some((value) =>
            String(value).toLowerCase().includes(query.toLowerCase()),
          )
        )
          continue;
        if (
          totalRows >= offset &&
          (limit === undefined || list.length < limit)
        ) {
          list.push(record);
        }
        totalRows++;
      }
    }
    return {
      list,
      pageInfo: {
        totalRows,
        page: limit ? Math.floor(offset / limit) + 1 : 1,
        pageSize: limit,
        isFirstPage: offset === 0,
        isLastPage: offset + list.length >= totalRows,
      },
    };
  }

  // Aggregate across every page without retaining the full dataset in memory.
  async aggregate(
    baseId: string,
    tableName: string,
    options: AggregateOptions,
  ): Promise<number | null> {
    if (!["count", "sum", "avg", "min", "max"].includes(options.func)) {
      throw new NocoDBError(`Unknown aggregate function: ${options.func}`);
    }
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for await (const records of this.recordPages(baseId, tableName, {
      where: options.where,
    })) {
      for (const record of records) {
        const value = Number(record[options.column_name]) || 0;
        count++;
        sum += value;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    switch (options.func) {
      case "count":
        return count;
      case "sum":
        return sum;
      case "avg":
        return count ? sum / count : 0;
      case "min":
        return count ? min : null;
      case "max":
        return count ? max : null;
    }
  }

  async groupBy(
    baseId: string,
    tableName: string,
    columnName: string,
    options?: QueryOptions,
  ): Promise<any[]> {
    const { offset, limit } = this.resultWindow(options);
    const groups = new Map<unknown, number>();
    for await (const records of this.recordPages(baseId, tableName, {
      where: options?.where,
      viewId: options?.viewId,
    })) {
      for (const record of records) {
        const value = record[columnName];
        groups.set(value, (groups.get(value) || 0) + 1);
      }
    }
    const result = Array.from(groups.entries()).map(([value, count]) => ({
      [columnName]: value,
      count,
    }));
    const sortFields = options?.sort
      ? Array.isArray(options.sort)
        ? options.sort
        : options.sort.split(",")
      : [];
    for (const field of sortFields) {
      if (![columnName, "count"].includes(field.replace(/^-/, ""))) {
        throw new NocoDBError(`Cannot sort groups by ${field}`);
      }
    }
    result.sort((a, b) => {
      for (const field of sortFields) {
        const descending = field.startsWith("-");
        const key = descending ? field.slice(1) : field;
        const left = a[key];
        const right = b[key];
        if (left === right) continue;
        const comparison =
          left == null ? -1 : right == null ? 1 : left < right ? -1 : 1;
        return descending ? -comparison : comparison;
      }
      return 0;
    });
    return result.slice(
      offset,
      limit === undefined ? undefined : offset + limit,
    );
  }

  // File upload operations
  async uploadFile(filePath: string, storagePath?: string): Promise<any> {
    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);

    formData.append("file", fileStream, fileName);
    if (storagePath) {
      formData.append("path", storagePath);
    }

    const response = await this.client.post(
      "/api/v2/storage/upload",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
      },
    );
    return response.data;
  }

  async uploadByUrl(urls: string[], storagePath?: string): Promise<any> {
    const urlData = urls.map((url) => ({ url }));
    const data = storagePath ? { urls: urlData, path: storagePath } : urlData;

    const response = await this.client.post(
      "/api/v2/storage/upload-by-url",
      data,
    );
    return response.data;
  }
}
