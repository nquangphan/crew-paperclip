-- Một project chạy trên nhiều máy: chuyển dữ liệu cũ lúc rollout (spec §3.6).
-- Chạy một lần sau khi plugin crew.core đã áp migration 0022 và mọi máy đang chạy project đã ghép (machine_pairings),
-- trước khi bật lại agent. Chạy lại không đổi gì (ON CONFLICT DO NOTHING). Script không xóa dòng nào.
-- Plugin không đọc được bảng lõi environments nên bước này nằm ở đây thay vì trong migration của plugin.
--
-- Chạy trên VPS (đã backup DB trước):
--   docker exec -i crew-v3-spike-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < crew/ops/backfill-machines.sql
--
-- Xem trước (chỉ SELECT, không ghi gì): bỏ dấu "--" ở đầu từng dòng của khối dưới và chạy riêng.
-- Khối 1: máy sẽ được gắn với từng project (host environment mặc định của agent vai trò = tailscale_ip của máy đã ghép).
-- SELECT DISTINCT r.company_id, r.project_id, p.machine_id, p.hostname
-- FROM plugin_crew_core_0433ea20b6.crew_project_roles r
-- CROSS JOIN LATERAL unnest(r.executor_agent_ids || ARRAY[r.assistant_agent_id, r.reviewer_agent_id, r.integrator_agent_id,
--   r.codex_executor_agent_id, r.opencode_executor_agent_id, r.codex_reviewer_agent_id]) AS role(agent_id)
-- JOIN public.agents a ON a.id = role.agent_id AND a.company_id = r.company_id AND a.status <> 'terminated'
-- JOIN public.environments e ON e.id = a.default_environment_id AND e.driver = 'ssh'
-- JOIN plugin_crew_core_0433ea20b6.machine_pairings p
--   ON p.company_id = r.company_id AND p.revoked_at IS NULL AND p.tailscale_ip = e.config->>'host'
-- ORDER BY 1, 2, 4;
-- Khối 2: cây đang mở của project có bảng vai trò, kèm host của người nhận issue gốc và của Trợ Lý.
-- SELECT i.identifier, i.status, ea.config->>'host' AS assignee_host, es.config->>'host' AS assistant_host
-- FROM public.issues i
-- JOIN plugin_crew_core_0433ea20b6.crew_project_roles r ON r.company_id = i.company_id AND r.project_id = i.project_id
-- LEFT JOIN public.agents aa ON aa.id = i.assignee_agent_id
-- LEFT JOIN public.environments ea ON ea.id = aa.default_environment_id
-- LEFT JOIN public.agents sa ON sa.id = r.assistant_agent_id
-- LEFT JOIN public.environments es ON es.id = sa.default_environment_id
-- WHERE i.parent_id IS NULL AND i.status NOT IN ('done', 'cancelled')
-- ORDER BY i.identifier;
BEGIN;
-- Mỗi project có bảng vai trò được gắn `ready` với mọi máy đã ghép đang chạy agent vai trò của nó: host environment
-- mặc định của agent = tailscale_ip của máy. Host không khớp máy đã ghép nào thì bỏ qua.
INSERT INTO plugin_crew_core_0433ea20b6.project_machines (company_id, project_id, machine_id, status, updated_at)
SELECT DISTINCT r.company_id, r.project_id, p.machine_id, 'ready', now()
FROM plugin_crew_core_0433ea20b6.crew_project_roles r
CROSS JOIN LATERAL unnest(r.executor_agent_ids || ARRAY[r.assistant_agent_id, r.reviewer_agent_id, r.integrator_agent_id,
  r.codex_executor_agent_id, r.opencode_executor_agent_id, r.codex_reviewer_agent_id]) AS role(agent_id)
JOIN public.agents a ON a.id = role.agent_id AND a.company_id = r.company_id AND a.status <> 'terminated'
JOIN public.environments e ON e.id = a.default_environment_id AND e.driver = 'ssh'
JOIN plugin_crew_core_0433ea20b6.machine_pairings p
  ON p.company_id = r.company_id AND p.revoked_at IS NULL AND p.tailscale_ip = e.config->>'host'
ON CONFLICT (company_id, project_id, machine_id) DO NOTHING;
-- Mỗi cây đang mở (gốc chưa done/cancelled) của project được ghim `auto`, reason {"backfill": true}, vào máy của người
-- nhận issue gốc, không có thì máy của Trợ Lý. Máy phải đã ghép và đã gắn với project ở bước trên, không thì bỏ qua
-- cây đó (cổng claim sẽ tự chọn máy ở run kế tiếp). Cây đã có ghim (kể cả của owner) giữ nguyên.
INSERT INTO plugin_crew_core_0433ea20b6.issue_machine_pins (company_id, root_issue_id, machine_id, source, reason, pinned_at)
SELECT i.company_id, i.id, chosen.machine_id, 'auto', '{"backfill": true}'::jsonb, now()
FROM public.issues i
JOIN plugin_crew_core_0433ea20b6.crew_project_roles r ON r.company_id = i.company_id AND r.project_id = i.project_id
CROSS JOIN LATERAL (
  SELECT pm.machine_id
  FROM (VALUES (1, i.assignee_agent_id), (2, r.assistant_agent_id)) AS candidate(rank, agent_id)
  JOIN public.agents a ON a.id = candidate.agent_id AND a.company_id = i.company_id
  JOIN public.environments e ON e.id = a.default_environment_id AND e.driver = 'ssh'
  JOIN plugin_crew_core_0433ea20b6.machine_pairings p
    ON p.company_id = i.company_id AND p.revoked_at IS NULL AND p.tailscale_ip = e.config->>'host'
  JOIN plugin_crew_core_0433ea20b6.project_machines pm
    ON pm.company_id = i.company_id AND pm.project_id = i.project_id AND pm.machine_id = p.machine_id
  ORDER BY candidate.rank, pm.machine_id
  LIMIT 1
) chosen
WHERE i.parent_id IS NULL
  AND i.status NOT IN ('done', 'cancelled')
ON CONFLICT (company_id, root_issue_id) DO NOTHING;
COMMIT;
SELECT 'project_machines' AS bang, count(*) AS so_dong FROM plugin_crew_core_0433ea20b6.project_machines
UNION ALL
SELECT 'issue_machine_pins', count(*) FROM plugin_crew_core_0433ea20b6.issue_machine_pins;
