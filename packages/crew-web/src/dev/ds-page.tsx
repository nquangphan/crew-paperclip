import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Label,
  Logo,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeScope,
  ToggleSwitch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ds';

function Showcase({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <ThemeScope theme={theme}>
      <TooltipProvider>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Logo />
            <Badge>{theme === 'dark' ? 'Theme tối' : 'Theme sáng'}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button>Mặc định</Button>
            <Button variant="cta">CTA</Button>
            <Button variant="secondary">Phụ</Button>
            <Button variant="outline">Viền</Button>
            <Button variant="ghost">Mờ</Button>
            <Button variant="link">Liên kết</Button>
            <Button variant="destructive">Xóa</Button>
            <Button disabled>Vô hiệu</Button>
            <Spinner />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Mặc định</Badge>
            <Badge variant="secondary">Phụ</Badge>
            <Badge variant="outline">Viền</Badge>
            <Badge variant="destructive">Lỗi</Badge>
            <Avatar>
              <AvatarFallback>2P</AvatarFallback>
            </Avatar>
            <ToggleSwitch checked onCheckedChange={() => {}} aria-label="Bật" />
            <Checkbox aria-label="Chọn" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tên project" hint="Tối đa 60 ký tự">
              <Input placeholder="Nhập tên" />
            </Field>
            <Field label="Mã project" error="Mã đã tồn tại">
              <Input defaultValue="CREW" aria-invalid />
            </Field>
            <Field label="Mô tả">
              <Textarea placeholder="Mô tả ngắn" />
            </Field>
            <div className="flex flex-col gap-2">
              <Label>Model</Label>
              <Select defaultValue="opus">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Tổng quan</TabsTrigger>
              <TabsTrigger value="b">Yêu cầu</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Nội dung tổng quan</TabsContent>
            <TabsContent value="b">Nội dung yêu cầu</TabsContent>
          </Tabs>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Project</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Chi tiết</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Card>
            <CardHeader>
              <CardTitle>Thẻ</CardTitle>
              <CardDescription>Mô tả thẻ</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã</TableHead>
                    <TableHead>Tiêu đề</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>CREW-1</TableCell>
                    <TableCell>Dựng khung UI</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Hộp thoại</DialogTitle>
                  <DialogDescription>Nội dung mô tả</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button>Đồng ý</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Xác nhận</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Chắc chắn?</AlertDialogTitle>
                  <AlertDialogDescription>Thao tác không hoàn tác được.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction>Tiếp tục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Ngăn bên</SheetTitle>
                  <SheetDescription>Nội dung ngăn bên</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>Nội dung popover</PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Sửa</DropdownMenuItem>
                <DropdownMenuItem>Xóa</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Chú thích</TooltipContent>
            </Tooltip>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost">Mở rộng</Button>
            </CollapsibleTrigger>
            <CollapsibleContent>Nội dung thu gọn</CollapsibleContent>
          </Collapsible>
          <Command>
            <CommandInput placeholder="Tìm lệnh" />
            <CommandList>
              <CommandEmpty>Không có kết quả</CommandEmpty>
              <CommandItem>Thêm project</CommandItem>
              <CommandItem>Tạo agent</CommandItem>
            </CommandList>
          </Command>
          <ScrollArea className="h-full">
            <Skeleton />
          </ScrollArea>
          <EmptyState title="Chưa có yêu cầu" description="Tạo yêu cầu đầu tiên cho project này." />
          <ErrorState title="Không tải được" message={'HTTP 500\n<b>không render HTML</b>'} onRetry={() => {}} />
        </div>
      </TooltipProvider>
    </ThemeScope>
  );
}

export function DsPage() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Showcase theme="light" />
      <Showcase theme="dark" />
    </div>
  );
}
