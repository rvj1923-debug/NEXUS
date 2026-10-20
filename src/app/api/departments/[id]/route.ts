import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await props.params;

  try {
    const department = await db.department.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true, phoneAssets: true, users: true },
        },
      },
    });

    if (!department) {
      return NextResponse.json({ error: "Department not found." }, { status: 404 });
    }

    // Unlink any employees assigned to this department
    if (department._count.employees > 0) {
      await db.employee.updateMany({
        where: { departmentId: id },
        data: { departmentId: null },
      });
    }

    // Unlink any phone assets assigned to this department
    if (department._count.phoneAssets > 0) {
      await db.phoneAsset.updateMany({
        where: { departmentId: id },
        data: { departmentId: null },
      });
    }

    // Unlink any user accounts assigned to this department
    if (department._count.users > 0) {
      await db.user.updateMany({
        where: { departmentId: id },
        data: { departmentId: null },
      });
    }

    // Permanently remove department
    await db.department.delete({
      where: { id },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "DELETE_DEPARTMENT",
      entityType: "DEPARTMENT",
      entityId: id,
      changes: { name: department.name, code: department.code },
    });

    return NextResponse.json({
      success: true,
      message: `Department '${department.name}' (${department.code}) was deleted successfully.`,
    });
  } catch (error: any) {
    console.error("Delete department error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete department." }, { status: 500 });
  }
}
