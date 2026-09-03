import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

/*
  Lint configuration.

  This exists because of a specific bug rather than as boilerplate. When
  the mock fixtures were deleted, one screen kept a reference to an
  identifier that no longer existed. `vite build` passed, because a bare
  undefined variable is not a build error in JavaScript, it is a
  ReferenceError at render time. That screen crashed the whole app the
  moment anyone opened it.

  So the rules below are deliberately narrow. They are the ones that
  catch mistakes the build cannot, not a general style opinion:

    no-undef            the bug above
    no-unused-vars      the other half of an incomplete refactor
    react-hooks/*       stale closures and conditional hooks

  Formatting is not linted. Prettier defaults are close enough, and
  arguing about them in review is not worth anyone's time.
*/

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks, react },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
        Without this, base no-unused-vars does not count a JSX tag as
        a use, so every imported component reads as unused and the
        real warnings drown in hundreds of false ones.
      */
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "no-undef": "error",
      // Unused caught errors are fine: several catch blocks exist only
      // to swallow blocked storage and have nothing to do with the error.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Config files run in Node, not the browser.
    files: ["vite.config.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
