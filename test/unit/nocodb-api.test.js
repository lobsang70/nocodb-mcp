const axios = require("axios");
const { NocoDBClient, NocoDBError } = require("../../dist/nocodb-api.js");
const { tableTools } = require("../../dist/tools/table.js");
const createAxios = axios.create.bind(axios);
let requests;
let respond;

beforeEach(() => {
  requests = [];
  jest.spyOn(axios, "create").mockImplementation((config) =>
    createAxios({
      ...config,
      adapter: async (request) => {
        requests.push(request);
        const reply = await respond(request);
        const response = {
          status: 200,
          statusText: "OK",
          headers: {},
          config: request,
          ...reply,
        };
        if (response.status >= 400) {
          throw new axios.AxiosError(
            "Request failed",
            "ERR_BAD_REQUEST",
            request,
            undefined,
            response,
          );
        }
        return response;
      },
    }),
  );
});
afterEach(() => jest.restoreAllMocks());

function client() {
  return new NocoDBClient({
    baseUrl: "https://nocodb.invalid",
    apiToken: "test-token",
  });
}
function serveRecords(records, { metadata = true, cap = 2, intercept } = {}) {
  respond = (request) => {
    const url = new URL(request.url, "https://nocodb.invalid");
    if (url.pathname === "/api/v1/db/meta/projects/base/tables") {
      return {
        data: { list: [{ id: "table", title: "Tasks", table_name: "tasks" }] },
      };
    }
    if (url.pathname !== "/api/v2/tables/table/records")
      throw new Error(`Unexpected ${request.url}`);
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Math.min(Number(url.searchParams.get("limit") || 25), cap);
    const intercepted = intercept?.(offset, request);
    if (intercepted) return intercepted;
    return {
      data: {
        list: records.slice(offset, offset + limit),
        ...(metadata
          ? {
              pageInfo: {
                page: Math.floor(offset / cap) + 1,
                pageSize: cap,
                totalRows: records.length,
                isLastPage: offset + limit >= records.length,
              },
            }
          : {}),
      },
    };
  };
}
function recordRequests() {
  return requests.filter((r) => r.url.startsWith("/api/v2/tables/"));
}
const records = [
  { ID: 1, Amount: 10, Team: "B", Name: "no" },
  { ID: 2, Amount: 20, Team: "A", Name: "no" },
  { ID: 3, Amount: 30, Team: "A", Name: "match one" },
  { ID: 4, Amount: 40, Team: "C", Name: "no" },
  { ID: 5, Amount: 50, Team: "A", Name: "MATCH two" },
  { ID: 6, Amount: 60, Team: "B", Name: "match three" },
];

describe("column updates", () => {
  const tool = tableTools.find((t) => t.name === "update_column");
  test("MCP handler updates only supplied properties and normalizes a table response", async () => {
    const updates = {
      title: "Priority",
      rqd: false,
      cdf: null,
      np: 0,
      colOptions: { options: [{ title: "Low" }] },
    };
    respond = (r) => {
      expect(r.method).toBe("patch");
      expect(r.url).toBe("/api/v2/meta/columns/column");
      expect(JSON.parse(r.data)).toEqual(updates);
      expect(r.headers.get("xc-token")).toBe("test-token");
      return {
        data: {
          id: "table",
          columns: [{ id: "other" }, { id: "column", ...updates }],
        },
      };
    };
    const result = await tool.handler(client(), {
      column_id: "column",
      updates,
    });
    expect(result.column).toEqual({ id: "column", ...updates });
    expect(requests).toHaveLength(1);
    expect(tool.inputSchema.required).toEqual(["column_id", "updates"]);
  });
  test("accepts a direct column response and encodes its ID", async () => {
    respond = () => ({
      data: { id: "col/id", title: "Name", uidt: "LongText" },
    });
    expect(
      await client().updateColumn("col/id", { uidt: "LongText" }),
    ).toMatchObject({ uidt: "LongText" });
    expect(requests[0].url).toBe("/api/v2/meta/columns/col%2Fid");
  });
  test("reads the field when PATCH returns only an acknowledgement", async () => {
    respond = (r) => ({
      data: r.method === "patch" ? 1 : { id: "column", title: "Renamed" },
    });
    expect(
      await client().updateColumn("column", { title: "Renamed" }),
    ).toMatchObject({ title: "Renamed" });
    expect(requests.map((r) => r.method)).toEqual(["patch", "get"]);
  });
  test.each([
    {},
    { typo: true },
    { title: " " },
    { rqd: "false" },
    { ns: -1 },
    { np: 1.5 },
    { title: undefined },
  ])(
    "rejects invalid updates before sending a request: %j",
    async (updates) => {
      await expect(client().updateColumn("column", updates)).rejects.toThrow();
      expect(requests).toHaveLength(0);
    },
  );
  test.each(["", " ", null])("rejects an invalid column ID: %j", async (id) => {
    await expect(client().updateColumn(id, { title: "Name" })).rejects.toThrow(
      "column_id",
    );
    expect(requests).toHaveLength(0);
  });
  test("preserves HTTP failure details without reporting success", async () => {
    respond = () => ({
      status: 422,
      data: { msg: "Invalid conversion", detail: "unsupported" },
    });
    await expect(
      tool.handler(client(), {
        column_id: "column",
        updates: { uidt: "Number" },
      }),
    ).rejects.toMatchObject({
      name: "NocoDBError",
      statusCode: 422,
      message: "Invalid conversion",
      details: { detail: "unsupported" },
    });
    expect(requests).toHaveLength(1);
  });
});

test("rejects an invalid follow-up column response", async () => {
  respond = () => ({ data: 1 });
  await expect(
    client().updateColumn("column", { title: "Name" }),
  ).rejects.toThrow("Could not read");
});

test("rejects a malformed record page", async () => {
  serveRecords(records, { intercept: () => ({ data: { list: null } }) });
  await expect(
    client().aggregate("base", "Tasks", { column_name: "Amount", func: "sum" }),
  ).rejects.toThrow("Invalid record page");
});

describe("pagination", () => {
  test.each([
    ["count", 6],
    ["sum", 210],
    ["avg", 35],
    ["min", 10],
    ["max", 60],
  ])(
    "%s includes every page even when the server caps page size",
    async (func, expected) => {
      serveRecords(records);
      expect(
        await client().aggregate("base", "Tasks", {
          column_name: "Amount",
          func,
          where: "(Active,eq,true)",
        }),
      ).toBe(expected);
      expect(
        recordRequests().map((r) =>
          Number(
            new URL(r.url, "https://n.invalid").searchParams.get("offset"),
          ),
        ),
      ).toEqual([0, 2, 4]);
      expect(
        recordRequests().every(
          (r) =>
            new URL(r.url, "https://n.invalid").searchParams.get("where") ===
            "(Active,eq,true)",
        ),
      ).toBe(true);
      expect(
        requests.filter((r) => r.url.includes("/meta/projects/")),
      ).toHaveLength(1);
    },
  );
  test.each([
    ["count", 0],
    ["sum", 0],
    ["avg", 0],
    ["min", null],
    ["max", null],
  ])("%s handles an empty dataset", async (func, expected) => {
    serveRecords([]);
    expect(
      await client().aggregate("base", "Tasks", {
        column_name: "Amount",
        func,
      }),
    ).toBe(expected);
  });
  test("continues through short pages without metadata until an empty page", async () => {
    serveRecords(records.slice(0, 5), { metadata: false });
    expect(
      await client().aggregate("base", "Tasks", {
        column_name: "Amount",
        func: "sum",
      }),
    ).toBe(150);
    expect(recordRequests()).toHaveLength(4);
  });
  test("groups all records, sorts by group count, then applies offset and limit once", async () => {
    serveRecords(records);
    expect(
      await client().groupBy("base", "Tasks", "Team", {
        sort: "-count",
        offset: 1,
        limit: 1,
      }),
    ).toEqual([{ Team: "B", count: 2 }]);
    expect(recordRequests()).toHaveLength(3);
  });
  test("sorts groups by their value", async () => {
    serveRecords(records);
    expect(
      await client().groupBy("base", "Tasks", "Team", { sort: "-Team" }),
    ).toEqual([
      { Team: "C", count: 1 },
      { Team: "B", count: 2 },
      { Team: "A", count: 3 },
    ]);
  });
  test("search finds matches on later pages and pages the matching results", async () => {
    serveRecords(records);
    const result = await client().searchRecords("base", "Tasks", "match", {
      offset: 1,
      limit: 1,
      sort: "ID",
      fields: ["ID", "Name"],
    });
    expect(result.list.map((r) => r.ID)).toEqual([5]);
    expect(result.pageInfo).toEqual({
      totalRows: 3,
      page: 2,
      pageSize: 1,
      isFirstPage: false,
      isLastPage: false,
    });
    expect(
      recordRequests().every(
        (r) =>
          new URL(r.url, "https://n.invalid").searchParams.get("sort") === "ID",
      ),
    ).toBe(true);
    expect(
      recordRequests().every(
        (r) =>
          new URL(r.url, "https://n.invalid").searchParams.get("fields") ===
          "ID,Name",
      ),
    ).toBe(true);
  });
  test("search with no matches returns consistent metadata", async () => {
    serveRecords(records);
    expect(
      await client().searchRecords("base", "Tasks", "absent"),
    ).toMatchObject({ list: [], pageInfo: { totalRows: 0, isLastPage: true } });
  });
  test("limit zero returns no groups or search results", async () => {
    serveRecords(records);
    const c = client();
    expect(await c.groupBy("base", "Tasks", "Team", { limit: 0 })).toEqual([]);
    expect(
      await c.searchRecords("base", "Tasks", "match", { limit: 0 }),
    ).toMatchObject({ list: [], pageInfo: { totalRows: 3 } });
  });
  test.each([{ offset: -1 }, { limit: -1 }, { limit: 1.5 }, { offset: NaN }])(
    "rejects invalid windows: %j",
    async (options) => {
      await expect(
        client().groupBy("base", "Tasks", "Team", options),
      ).rejects.toThrow("non-negative integer");
      await expect(
        client().searchRecords("base", "Tasks", "match", options),
      ).rejects.toThrow("non-negative integer");
      expect(requests).toHaveLength(0);
    },
  );
  test("a later page HTTP error rejects the whole aggregate", async () => {
    serveRecords(records, {
      intercept: (offset) =>
        offset === 2
          ? { status: 503, data: { msg: "Unavailable" } }
          : undefined,
    });
    await expect(
      client().aggregate("base", "Tasks", {
        column_name: "Amount",
        func: "sum",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
  test("does not silently accept an empty page marked non-final", async () => {
    serveRecords(records, {
      intercept: () => ({
        data: { list: [], pageInfo: { isLastPage: false } },
      }),
    });
    await expect(client().groupBy("base", "Tasks", "Team")).rejects.toThrow(
      "Empty record page",
    );
  });
  test("rejects non-advancing page metadata", async () => {
    serveRecords(records, {
      intercept: () => ({
        data: {
          list: records.slice(0, 2),
          pageInfo: { page: 1, isLastPage: false },
        },
      }),
    });
    await expect(client().groupBy("base", "Tasks", "Team")).rejects.toThrow(
      "did not advance",
    );
    expect(recordRequests()).toHaveLength(2);
  });
  test("listRecords remains a single-page API", async () => {
    serveRecords(records);
    expect(
      (
        await client().listRecords("base", "Tasks", { limit: 2, offset: 2 })
      ).list.map((r) => r.ID),
    ).toEqual([3, 4]);
    expect(recordRequests()).toHaveLength(1);
  });
});
