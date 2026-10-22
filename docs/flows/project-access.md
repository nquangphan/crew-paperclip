# Quyền xem project theo thành viên

> Flow `project-access`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow project-access` in ra đúng danh sách đó.

## Mục đích

Một company Crew có nhiều project; thành viên người (admin, operator, viewer, Phòng Marketing, Phòng QC) chỉ nên thấy
project owner cấp cho họ. Luật:

- Owner thấy mọi project và cả issue không thuộc project nào. Mọi thành viên khác mặc định không thấy gì, chỉ thấy
  project được cấp, và không thấy issue không thuộc project nào. Agent không bị ảnh hưởng.
- Bảng quyền chưa có (plugin chưa nâng cấp) hay tải quyền lỗi thì người bị giới hạn không thấy project nào (đóng khi lỗi).
- Giới hạn: chỉ UI Crew và router Crew áp luật này. API lõi của Paperclip không đổi, nên gọi thẳng API lõi vẫn thấy
  mọi project của company. Đây là ẩn khỏi giao diện, không phải ranh giới bảo mật.
- Router Crew dùng luật này thật sự ở góp ý: người góp ý không gửi được vào project hay issue mình không xem được, và
  owner không duyệt được mục của người đã mất quyền xem project đó (flow `contributions`). Vòng QC cũng lọc theo quyền
  này (flow `qc-department`).

## Điểm vào

- Route (gắn bên trong router góp ý, vá C7; chỉ actor board đăng nhập bằng phiên trình duyệt, role đọc từ DB):
  `GET /api/crew/companies/:companyId/project-access/me`, `GET /api/crew/companies/:companyId/project-access` (owner),
  `PUT /api/crew/companies/:companyId/project-access/:userId` với `{ projectIds }` (owner).
- UI: `AccessGuard` là route layout dưới `/:companyPrefix`; owner đặt quyền ở trang Thành viên (`ProjectAccessCell`).

## Các bước

1. `server/src/crew/project-access.ts` → `visibleProjectsFor`, `canSeeProject`, `assertProjectVisible`,
   `grantedProjectIds`: luật thấy project cho router Crew.
2. `server/src/crew/project-access.ts` → `listProjectAccess`, `setProjectAccess`: owner liệt kê và thay toàn bộ danh sách
   project của một thành viên người đang hoạt động (không phải owner, tối đa `PROJECT_ACCESS_MAX`); project phải thuộc
   company, project đã lưu trữ vẫn cấp được.
3. `server/src/crew/project-access-routes.ts` → `crewProjectAccessRoutes`: ba route trên, người gọi xác định bằng
   `resolveContributionActor`.
4. `packages/crew-web/src/features/access/use-company-access.ts` → `useCompanyAccess`, `deriveAccess`: vai trò từ
   `GET /access` (owner, khách góp ý và phòng, role lõi, chỉ đọc). Đang tải thì coi là chỉ đọc để nút ghi không chớp;
   lỗi tải thì không khóa UI (server vẫn là cổng thật).
5. `packages/crew-web/src/features/access/use-visible-projects.ts` → `useVisibleProjects`, `filterProjects`,
   `filterIssues`, `canSeeIssue`: lọc mọi danh sách theo `project-access/me`.
6. `packages/crew-web/src/features/access/nav-access.ts` → `navItemVisible`, `navLabelKey`, `routeAllowed`,
   `routeNeedsAccess`: mục sidebar và trang theo vai trò (chỉ là UI).
7. `packages/crew-web/src/features/access/access-guard.tsx` → `AccessGuard`: chờ vai trò và quyền xem tải xong, báo lỗi kèm
   Thử lại thay vì đoán, chuyển trang bị cấm về Tổng quan.
8. `packages/crew-web/src/features/members/project-access-cell.tsx` → `ProjectAccessCell`, `ProjectChecklist`,
   `ProjectNames`: ô chọn project trên trang Thành viên; dữ liệu qua `packages/crew-web/src/api/crew/project-access.ts`
   (`projectAccessApi`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/project-access.ts` | Luật thấy project, đọc/ghi bảng quyền | `visibleProjectsFor`, `canSeeProject`, `assertProjectVisible`, `setProjectAccess`, `listProjectAccess`, `PROJECT_ACCESS_ERRORS` |
| `server/src/crew/project-access-routes.ts` | Route quyền xem project | `crewProjectAccessRoutes` |
| `packages/crew-web/src/api/crew/project-access.ts` | Client API | `projectAccessApi` |
| `packages/crew-web/src/features/access/access-guard.tsx` | Route layout chặn trang | `AccessGuard` |
| `packages/crew-web/src/features/access/use-company-access.ts` | Vai trò người xem | `useCompanyAccess`, `deriveAccess` |
| `packages/crew-web/src/features/access/use-visible-projects.ts` | Lọc project và issue | `useVisibleProjects`, `filterProjects`, `filterIssues`, `NO_PROJECTS` |
| `packages/crew-web/src/features/access/nav-access.ts` | Mục và trang theo vai trò | `navItemVisible`, `routeAllowed` |
| `packages/crew-web/src/features/access/index.ts` | Export của feature | (re-export) |
| `packages/crew-web/src/features/members/project-access-cell.tsx` | Ô cấp project trên trang Thành viên | `ProjectAccessCell`, `ProjectChecklist` |

## Dữ liệu

- Bảng plugin: `crew_project_access` (khóa `company_id, user_id, project_id`; migration
  `packages/crew-plugin/migrations/0016_project_access.sql`). Chỉ router Crew của server đọc/ghi.
- Bảng lõi: đọc `company_memberships`, `projects`, `issues`.
- Lỗi: `crew_project_not_visible`, `crew_project_access_unavailable` (503), `crew_project_access_invalid`,
  `crew_project_access_not_member`.

## Flow liên quan

- `contributions`: router cha, `resolveContributionActor`, và nơi luật được áp ở server.
- `qc-department`: danh sách vòng QC lọc theo quyền xem project.
- `web-shell`: router của crew-web gắn `AccessGuard`.
- `web-pages`, `issues-web`, `roadmap-map`: các trang dùng `useVisibleProjects` để lọc.

## Tests

- `server/src/__tests__/crew-project-access.db.test.ts`: chưa có bảng thì đóng; mặc định không thấy gì; chỉ owner xem và
  đặt quyền; kiểm dữ liệu (owner, người lạ, project company khác, body sai); cấp, thay, thu hồi; góp ý bị chặn ở project
  và issue không xem được; duyệt khi người gửi mất quyền.
- `packages/crew-plugin/src/__tests__/migration-0016.db.test.ts`: migration thêm bảng và khóa chính, giữ dữ liệu cũ.
- `packages/crew-web/test/features/access/use-visible-projects.test.tsx`: hàm lọc thuần, đọc `project-access/me`, owner
  không bị giới hạn, lỗi thì không thấy gì.
- `packages/crew-web/test/features/access/use-company-access.test.tsx`: suy vai trò, chỉ đọc khi tải, phòng của khách,
  lỗi không khóa UI.
- `packages/crew-web/test/features/access/nav-access.test.ts`, `sidebar-access.test.tsx`: mục sidebar và route theo vai
  trò; route cần vai trò báo lỗi khi không tải được.
- `packages/crew-web/test/features/access/read-only.test.tsx`: trang yêu cầu và project ở chế độ chỉ đọc cho viewer và
  khách.
- `packages/crew-web/test/features/access/skeleton-pages.test.tsx`: trang Góp ý và Thành viên hiện đúng theo vai trò.
