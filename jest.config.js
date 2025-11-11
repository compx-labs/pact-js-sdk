module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 20000,
  moduleNameMapper: {
    '^algosdk/client$': 'algosdk/dist/cjs/client/index.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
