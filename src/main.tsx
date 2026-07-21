[fix/reload-identifier-sync 037a0dc] Avoid identifier sync errors on page reload
 1 file changed, 12 insertions(+), 4 deletions(-)
diff --git a/src/main.tsx b/src/main.tsx
index 8567a9b..36de4e8 100644
--- a/src/main.tsx
+++ b/src/main.tsx
@@ -107,15 +107,23 @@ function App() {
   }, [userId]);
   useEffect(() => { void loadConcept(selected); }, [selected]);
   useEffect(() => {
-    if (!supabase || !userId || normalizingIdentifiers.current) return;
+    // A reload must not perform a write to Google Sheets when every record that
+    // has reached the generation workflow already has its durable numeric ID.
+    // Sending a new record still assigns its ID in the send endpoint; this is
+    // only a one-time repair path for legacy/incomplete records.
+    const needsIdentifierRepair = items.some((item) =>
+      item.status !== "New" && item.status !== "Archived" && !/^\d+$/.test(String(item.generationIdentifier ?? "").trim()),
+    );
+    if (!supabase || !userId || !needsIdentifierRepair || normalizingIdentifiers.current) return;
     const client = supabase;
     normalizingIdentifiers.current = true;
     void client.auth.getSession().then(async ({ data }) => {
       if (!data.session) return;
       const response = await fetch("/api/normalize-identifiers", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
       if (!response.ok) {
-        const failure = await response.json().catch(() => null);
-        notify(failure?.error || "Couldn’t synchronize identifiers. Please try again.");
+        // This is a background repair. Do not interrupt the user on reload;
+        // generation actions surface their own precise Google Sheets errors.
+        await response.json().catch(() => null);
         return;
       }
       const result = await response.json();
@@ -128,7 +136,7 @@ function App() {
         }));
       }
     });
-  }, [userId]);
+  }, [userId, items]);
   const updateStatus = async (id: string, status: "discarded" | "new" | "sent_to_sheets" | "generated" | "approved_to_post") => {
     if (!supabase) return;
     const { error } = await supabase.from("articles").update({ status }).eq("id", id);
