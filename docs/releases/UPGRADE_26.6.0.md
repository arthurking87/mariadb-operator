# 26.06 update guide

This guide illustrates, step by step, how to update to `26.6.0` from previous versions. This guide only applies if you are updating from a version prior to `26.6.x`, otherwise you may upgrade directly (see [Helm](../helm.md#updates))

> [!TIP]
> The [OCI-based installation](../helm.md#oci-based-installation) is recommended. To migrate an existing release, run `helm upgrade --install` with the same release but pointing to the `oci://` path. Refer to [this guide](https://www.securecodebox.io/blog/2024/06/28/helm-chart-oci-registry-migration/) for further information. 

> [!CAUTION]
> When migrating `mariadb-operator-crds` to the [OCI-based installation](../helm.md#oci-based-installation), always use `helm upgrade` in-place. Running `helm uninstall` first will delete the CRDs and cascade-delete all CRs, causing downtime.

- The [data-plane](../data_plane.md) must be updated to the `26.6.0` version. You must set `updateStrategy.autoUpdateDataPlane=true` in your `MariaDB` resources before updating the operator. Then, once updated, the operator will also be updating the data-plane based on its version:
```diff
apiVersion: k8s.mariadb.com/v1alpha1
kind: MariaDB
metadata:
  name: mariadb-galera
spec:
  updateStrategy:
+   autoUpdateDataPlane: true
```

- At this point, you may proceed to update the operator:

Upgrade the `mariadb-operator-crds` helm chart to `26.6.0`:
```bash
helm repo update mariadb-operator
helm upgrade --install mariadb-operator-crds mariadb-operator/mariadb-operator-crds --version 26.6.0
```

Upgrade the `mariadb-operator` helm chart to `26.6.0`:
```bash 
helm repo update mariadb-operator
helm upgrade --install mariadb-operator mariadb-operator/mariadb-operator --version 26.6.0
```

- If you are using replication, and you have the `spec.replication.syncBinlog` field set, some breaking changes have been introduced that affect you: it has been replaced by `syncBinlogPrimary`/`syncBinlogReplica`, applied by the operator to the currently promoted primary and to replicas respectively (see [replication configuration](../replication.md#configuration)). This CRD upgrade does not migrate the old value for you — it is silently discarded, and the new fields default to `syncBinlogPrimary=1`/`syncBinlogReplica=5` if left unset.

Please perform the following migration on the `spec.replication.syncBinlog` field:
- If you previously relied on a single `syncBinlog=<number>` for all nodes, set both `syncBinlogPrimary=<number>` and `syncBinlogReplica=<number>` to keep the previous behavior, or leave them unset to adopt the new defaults (`1` on primary for durability, `5` on replicas for throughput).

```diff
apiVersion: k8s.mariadb.com/v1alpha1
kind: MariaDB
metadata:
  name: mariadb
spec:
  replication:
-    syncBinlog: 1
+    syncBinlogPrimary: 1
+    syncBinlogReplica: 1
```

- Consider reverting `updateStrategy.autoUpdateDataPlane` back to `false` in your `MariaDB` object to avoid unexpected updates:

```diff
apiVersion: k8s.mariadb.com/v1alpha1
kind: MariaDB
metadata:
  name: mariadb-galera
spec:
  updateStrategy:
+   autoUpdateDataPlane: false
-   autoUpdateDataPlane: true
```
