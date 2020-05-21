# Nextflow Sandbox Extension for Visual Studio Code

This extension provides convenient tree views and ease-of-use utilities for managing, configuring, running, and debugging Nextflow pipelines.

## Features

* Quickly create new pipelines which reference existing Nextflow scripts, configurations, and parameter files
   
* Specify the storage folder location for the work folders and files created by Nextflow runs

* Set options and arguments for the Nextflow command-line

* Execute Nextflow Run, Resume, or Config with one click (versus typing the command into a terminal)

* Automatically group and decorate work folders using human-readable process names instead of cryptic hexidecimal process identifiers

* Open work folders in a terminal or reveal them in the finder with one click

* Launch docker container with process work folder mapped with one click (for processes utilizing docker)

## Requirements

[Nextflow](https://www.nextflow.io/)

## Extension Settings

This extension contributes the following settings:

* `nextflow-sandbox.executablePath`: path to the Nextflow executable
* `nextflow-sandbox.storagePath`: path where Nextflow will store local work
* `nextflow-sandbox.autoShowLog`: automatically show log upon Nextflow exit
* `nextflow-sandbox.archivePreviousRun`: archive previous run work folders before running

## Known Issues

None

## Release Notes

### 0.0.1

Initial release of Nextflow Sandbox

