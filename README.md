# Nextflow Sandbox (version 2) Extension for Visual Studio Code

This extension provides convenient tree views and ease-of-use utilities for managing, configuring, running, and debugging Nextflow pipelines.

## Features

* Quickly create new pipelines which reference existing Nextflow repositories, scripts, configurations, and parameter files
   
* Specify the storage folder location for the work folders and files created by Nextflow runs

* Set options and arguments for the Nextflow command-line

* Execute Nextflow Run, Resume, Config, and Pull with one click (versus typing the command into a terminal)

* Automatically group and decorate work folders using human-readable process names instead of cryptic hexidecimal process identifiers

* Open work folders in a terminal or reveal them in the finder with one click

* Launch Docker container with process work folder mapped with one click (for processes utilizing Docker)

## Requirements

[Nextflow](https://www.nextflow.io/)

## Extension Settings

This extension contributes the following settings:

* `nextflow-sandbox.executablePath`: path to the Nextflow executable
* `nextflow-sandbox.storagePath`: path where Nextflow will store local work
* `nextflow-sandbox.autoShowLog`: automatically show log upon Nextflow exit
* `nextflow-sandbox.shellPath`: custom shell executable path
* `nextflow-sandbox.shellArgs`: custom shell executable args

## Known Issues

None

## Release Notes

I created this extension for my personal use, as my daily activities generally include running one or more Nextflow pipelines, and I wanted to automate the features that I exercise most.

As an isolated user, the use-cases I have added support for are clearly limited to my personal experience using Nextflow.  If you find this extension useful, I am very interested in receiving feedback, including any issues encountered with its use, as well as features not implemented that would be useful to you.  I am happy to update this extension so that everyone may benefit.

If you would like to [report](https://github.com/michael-brazell-md/nextflow-sandbox/issues) a bug or feature request, please do so on the github [repository](https://github.com/michael-brazell-md/nextflow-sandbox) for this project.  I will make every effort to respond in a timely manner.

If you enjoy using this extension, please leave a rating!

### 0.0.1

Initial release of Nextflow Sandbox.

### 0.0.2

Removed unnecessary quotes around the '--args' parameter.

### 0.0.3

Added optional selection of the pipeline storage path when creating a new pipeline.

### 0.0.4

Fixed issue caused by singular args value.

### 0.0.5

Added port mapping to Launch Container when launching docker container, to support java remote debugging.

### 0.0.6

Removed "stopped" description on pipelines; now only displays "running" when running.

### 0.0.7

Added support for project repositories.

### 0.0.8

Added "pull" Nextflow command support.

### 0.0.9

Added extension icon.

### 0.1.0

Added support for launching a container with 1+ spaces within the pipeline path.

### 0.1.1

Fixed issue caused by multiple spaces within the pipeline path when launching a container.

### 0.1.2

Found an issue with escaped characters in the Nextflow container run command when launching a container from a pipeline with spaces in its name; opted to replace spaces with underscores when creating a pipeline to bypass the issue altogether; may revisit at a later date.

### 0.1.3

Now handles escaped characters in the Nextflow container run command when launching a container from a pipeline with spaces in its name.

### 0.1.4

Resolved an issue caused by incorrect placement of the configuration file option (-c) when executing the Nextflow config command.

Removed automatic port mapping with Launch Container when launching docker container, as it would fail if the port was already in use.

### 0.1.5

Resolved issue with command args.

Removed "profile" configuration setting, as this may be set in the "args" configuration setting, and was therefore redundant.

### 0.1.6

Removed "Resume" context menu item for pipelines, as this may be set in the "args" configuration settings (-resume), and was therefore redundant.

### 0.1.7

Removed notion of archiving previous runs, as this prevents resuming.

### 0.1.8

Added "Configure from nextflow run command-line..." pipeline context menu item, which parses a nextflow run command-line and formulates the pipeline configuration from that.

### 0.1.9

Updated "Configure from nextflow run command-line..." to better handle arbitrary project repo/script placement within the command-line.

### 0.2.0

Added shellPath and shellArgs settings.