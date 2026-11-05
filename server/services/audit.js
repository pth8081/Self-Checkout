import { nowIso } from '../util.js';

export function audit(db, { storeId = null, actorType, actorId = null, action, entity = null, entityId = null, data = null }) {
  db.prepare(`INSERT INTO audit_events(ts,store_id,actor_type,actor_id,action,entity,entity_id,data)
    VALUES(?,?,?,?,?,?,?,?)`).run(nowIso(), storeId, actorType, actorId, action, entity, entityId, data ? JSON.stringify(data) : null);
}
