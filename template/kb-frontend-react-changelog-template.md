---
name: kb-frontend-react-changelog-template
description: Standardized changelog template for documenting all notable changes to DNext React projects following Keep a Changelog format and Semantic Versioning
version: "2.0.0"
metadata:
    dnext-ui-kit-version: "2.4.1"
    category: documentation
    tags:
        - changelog
        - versioning
        - release-notes
        - documentation-template
        - semantic-versioning
    see-also:
        - kb-frontend-react-release-notes-template.md
---

# Changelog

> **For documentation requirements, see [kb-frontend-react-build-verification.md](kb-frontend-react-build-verification.md) (Section 3).**

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - Issue summary

### New Feature

- **Feature description**: (@username)

    [Issue #12345](https://dnext-technology.atlassian.net/browse/PRND-12345) Added configuration to enable ID generation for agreements and agreement specifications.

    **Impact:** The application now supports automatic ID generation for key entities using external ID generation service.

## [2.2.0] - Issue summary

### Improvement

- **Library version update**: (@username)

    Updated the library version to the latest version.

    **Impact:** The application now supports the latest version of the library.

## [2.1.0] - Issue summary

### Security/Vulnerability

- **Vulnerability fix**: (@username)

    Updated the library version to fix vulnerability

    **Impact:** There is not any risk about the {Vulnerability-ID}.

## [2.0.1] - Issue summary

### Defect fixes

- **[Issue #12345](https://dnext-technology.atlassian.net/browse/PRND-12345) Defect summary:** (@username)
- **Prior to this release:**
    - Removing an item from the Bundled Product Offering table caused the data source of the Bundled Group Product Offering tables to be duplicated across all groups.
- **With this release:**
    - The synchronization error between the Bundled Product Offering table and Bundled Group Product Offering tables has been resolved.
    - A confirmation pop-up has been added for delete operations in the Bundled Product Offering table.

## [2.0.0] - Issue summary

### Breaking changes

- **Breaking change description**: (@username)

    The application now supports the latest version of the library.

    **Impact:** The application now supports the latest version of the library.

## [1.0.1] - Issue summary

### DevOps notes

- **CI/CD pipeline**: (@username)
  The CI/CD pipeline now supports the latest version of the library.

    **Impact:** The application now supports the latest version of the library.

## [1.0.1] - Issue summary

### Configuration Changes

- **New workflow configuration added**: (@username)

    The new workflow configuration added to the application. we are using the Camunda Rest API to start a new workflow.

    **Impact:** The new configuration must be added to the application configuration file `app-config.js`.
