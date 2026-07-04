const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                global: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                // Node.js built-in globals
                fetch: 'readonly',
                AbortController: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                URLSearchParams: 'readonly',
                // Mocha globals
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                after: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly'
            }
        },
        rules: {
            // Crockford-inspired formatting
            indent: ['error', 4],
            quotes: ['error', 'single'],
            semi: ['error', 'always'],
            'no-trailing-spaces': 'error',
            'eol-last': 'error',
            'no-multiple-empty-lines': ['error', { max: 1 }],
            'comma-dangle': ['error', 'never'],
            'brace-style': ['error', '1tbs', { allowSingleLine: true }],
            'space-before-function-paren': ['error', 'never'],
            'keyword-spacing': 'error',
            'space-infix-ops': 'error',
            'space-unary-ops': 'error',

            // Code quality
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-debugger': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-with': 'error',
            'no-caller': 'error',
            'no-extend-native': 'error',
            'no-extra-bind': 'error',
            'no-multi-spaces': 'error',
            'no-global-assign': 'error',

            // Your custom overrides
            'no-underscore-dangle': 'off',
            'no-continue': 'off'
        }
    },
    // apps/debug/public is browser-loaded (<script type="module">), not
    // Node — scoped here rather than added to the shared globals above so
    // Node-side no-undef checking stays strict everywhere else.
    {
        files: ['apps/debug/public/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                alert: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly'
            }
        }
    }
];
