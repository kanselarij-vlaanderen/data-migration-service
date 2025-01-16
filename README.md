# Yggdrasill
_[[ˈyɡːˌdrɑselː]] An immense and central sacred tree. Around it exists all else, including the Nine worlds._

Microservice propagating agenda data to graphs according to the authorization rules of the user groups.

# Getting started

## Add the yggdrasil service to your stack

Add the following snippet to your `docker-compose.yml`:
```yml
  yggdrasil:
    image: kanselarij/yggdrasil:5.12.1
```

Next, make the service listen for new delta messages. Assuming a delta-notifier is already available in the stack, add the following rules to the delta-notifier's configuration in `./config/delta/rules`.

```javascript
export default [
  {
    match: {
      subject: {
      }
    },
    callback: {
      url: 'http://yggdrasil/delta',
      method: 'POST'
    },
    options: {
      resourceFormat: 'v0.0.1',
      gracePeriod: 10000,
      ignoreFromSelf: true
    }
  }
];
```

# How-to guides

## How to run the initial load

By default, Yggdrasil assumes the initial load has been done. The initial load has to be enabled specifically, and disabled afterwards. During initial load, deltas will not be handled, but queued for future processing.

Before starting the initial load, the target graphs need to be cleaned manually.
For each user group, execute
```sparql
DROP SILENT GRAPH <user group graph>
```

When the the `RELOAD_ON_INIT` flag is enabled on start-up of Yggdrasil, the initial load will be triggered.

It is a good practice to enable the `USE_DIRECT_QUERIES` flag together with the `RELOAD_ON_INIT` flag.
This will make sure that when copying the data from the temp graph to the target graph, a `COPY <temp-graph> TO <target-graph>` will be executed directly on Virtuoso, instead of copying in batches through mu-authorization. Given the huge amount of data (+- 11M triples per graph), the `COPY` action is much more efficient.


# Reference
## User group and graphs
Every user group has his own dedicated graph, as configured in [`
app-kaleidos`](https://github.com/kanselarij-vlaanderen/app-kaleidos/blob/development/config/authorization/config.ex).
A user that is member of a specific user group can only see the data present in the graph of this group.

- Kanselarij: `http://mu.semte.ch/graphs/organizations/kanselarij`
- Minister: `http://mu.semte.ch/graphs/organizations/minister`
- Regering (kabinetten): `http://mu.semte.ch/graphs/organizations/intern-regering`
- Overheid: `http://mu.semte.ch/graphs/organizations/intern-overheid`


## API

### POST /delta

Endpoint that receives delta's from the delta-notifier and triggers the propagation of agenda related data if needed.
The endpoint is triggered externally whenever agenda related data has been updated and is not supposed to be triggered manually.

## Configuration

The following environment variables can be optionally configured:

| Name                      | Default value       | Description                             |
|---------------------------|---------------------|-----------------------------------------|
|`KEEP_TEMP_GRAPH`          | false               | Enable when the temp graphs should not be cleaned up when starting the service. Could be useful for development purposes. |
|`RELOAD_ON_INIT`           | false               | Flag to trigger the initial load (see also [How to run the initial load](#how-to-run-the-initial-load)) |
|`MU_SPARQL_ENDPOINT`       | `http://database:8890/sparql` | The sparql endpoint to be used to connect to mu-authorization
|`DIRECT_SPARQL_ENDPOINT`   | ` http://triplestore:8890/sparql` | The sparql endpoint to be used to connect directly to Virtuoso (linked to variable `USE_DIRECT_QUERIES`)
|`USE_DIRECT_QUERIES`       | false               | When enabled, the copy action will go directly to Virtuoso using a `COPY` graph operation instead of going through mu-authorization |
|`NB_OF_QUERY_RETRIES`      | 6                   | Number of times a failed query will be retried. Only applicable to direct queries.
|`RETRY_TIMEOUT_MS`         | 1000                | Query timeout (ms). Only applicable to direct queries.
|`DELTA_INTERVAL_MS`        | 60000               | Time to wait before starting the next data propagation (ms) when the first delta arrives. This allows to collect multiple delta messages in 1 propagation process. |
|`VIRTUOSO_RESOURCE_PAGE_SIZE` | 10000                | The number of triples selected in the subquery (= VIRTUOSO_RESOURCE_PAGE_SIZE * triples_for_resource). should not exceed the maximum number of triples returned by the database. (ie. ResultSetMaxRows in Virtuoso). Should also not exceed the maximum number of rows sorted. (ie MaxSortedTopRows in virtuoso) |

Logging can be enabled or disabled on different levels, using `true` or `false`


* `LOG_INCOMING_DELTA`
* `LOG_DIRECT_QUERIES`
* `LOG_SPARQL_ALL`
* `LOG_INCOMING_DELTA`
* `LOG_DELTA_PROCESSING`
* `LOG_INITIALIZATION`

All logging environment variables are disabled by default, only `LOG_DELTA_PROCESSING` is enabled by default.

## Workflow

The data propagation is always done at the level of the agendas. The data is collected by `Collectors` into a temp graph.
After collecting, the data is copied to the target graph of the user group.

Propagations can not run simultaneously. When a propagation is already running, the incoming delta messages will be kept in cache and will be processed once the previous propagation has finished, taking into account the environment variable `DELTA_INTERVAL_MS`.

There are 2 ways to initiate the data propagation by Yggdrasil: through delta handling or via the initial load.

### **1. Delta handling**
This is the regular workflow.

**High-level delta handling flow**

1. reduce the incoming deltas to a list of unique subject/objects
2. determine the linked agenda for every subject/object based on the model configured in [`model.js`](./model.js)
3. for every user group and for every determined agenda, execute the `Distributor` according to following steps:
    * collecting the URIs of all resources related to one of the agendas in the temp graph. Depending on the user group, the status of the documents release and the document's access levels are taken into account.
For every resource the link to the related agenda is persisted by a triple `?resource ext:tracesLineageTo ?agenda` (can be more than 1 agenda).
    * for every URI in the temp graph the details are copied into the temp graph (meaning all incoming and outgoing triples). In this step, access restrictions are not taken into account anymore. If a resource shouldn't be available for a specific group, it is already filtered out in the previous step.
    * cleanup of previously published data which should no longer be visible in the target graph
    * copy the data from the temp graph to the target graph. Only the diff between the graphs will be copied. Triples that already exist in the target graph will not be copied.
    * remove the temp graph

### **2. Initial load**
The flow of the initial load is similar to the flow of delta handling.

In the initial load, the `Collectors` will get the data related to ALL agendas and propagate the data according the the authorization rules of the different user groups.


The initial load can be configured by the environment variable `RELOAD_ON_INIT` flag. The initial load can be time consuming (+/- 40 min). You can find more details about the initial load here: [How to run the initial load](#how-to-run-the-initial-load)


