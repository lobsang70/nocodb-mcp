module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/unit/**/*.test.js"],
  clearMocks: true,
  collectCoverageFrom: [
    "dist/nocodb-api.js",
    "dist/column-update.js",
    "dist/tools/table.js",
  ],
};
