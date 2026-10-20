import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import {
  formatSupervisorEmails,
  formatSupervisorNames,
  isValidSupervisorEmailList,
} from "@/lib/supervisors";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const departments = await db.department.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: { employees: true, phoneAssets: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ departments });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      name,
      code,
      description,
      supervisorName,
      supervisorEmail,
      supervisor2Name,
      supervisor2Email,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Department name is required." }, { status: 400 });
    }

    if (!code || typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Department code is required." }, { status: 400 });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanDesc = description && typeof description === "string" ? description.trim() : null;
    const cleanSupName = formatSupervisorNames(
      typeof supervisorName === "string" ? supervisorName : null,
      typeof supervisor2Name === "string" ? supervisor2Name : null
    );
    const cleanSupEmail = formatSupervisorEmails(
      typeof supervisorEmail === "string" ? supervisorEmail : null,
      typeof supervisor2Email === "string" ? supervisor2Email : null
    );

    if (cleanSupEmail && !isValidSupervisorEmailList(cleanSupEmail)) {
      return NextResponse.json(
        { error: "One or more supervisor email addresses are invalid." },
        { status: 400 }
      );
    }

    // Check if code or name already exists
    const existing = await db.department.findFirst({
      where: {
        OR: [
          { code: { equals: cleanCode, mode: "insensitive" } },
          { name: { equals: cleanName, mode: "insensitive" } },
        ],
      },
    });

    if (existing) {
      if (existing.code.toUpperCase() === cleanCode) {
        return NextResponse.json(
          { error: `Department code '${cleanCode}' is already in use by '${existing.name}'.` },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `Department name '${cleanName}' already exists with code '${existing.code}'.` },
        { status: 409 }
      );
    }

    const department = await db.department.create({
      data: {
        name: cleanName,
        code: cleanCode,
        description: cleanDesc,
        supervisorName: cleanSupName,
        supervisorEmail: cleanSupEmail,
        isActive: true,
      },
      include: {
        _count: {
          select: { employees: true, phoneAssets: true },
        },
      },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "CREATE_DEPARTMENT",
      entityType: "DEPARTMENT",
      entityId: department.id,
      changes: {
        name: cleanName,
        code: cleanCode,
        description: cleanDesc,
        supervisorName: cleanSupName,
        supervisorEmail: cleanSupEmail,
      },
    });

    return NextResponse.json({ success: true, department });
  } catch (error: any) {
    console.error("Create department error:", error);
    return NextResponse.json({ error: error.message || "Failed to create department." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      id,
      name,
      code,
      description,
      supervisorName,
      supervisorEmail,
      supervisor2Name,
      supervisor2Email,
    } = body;

    if (!id) {
      return NextResponse.json({ error: "Department ID is required." }, { status: 400 });
    }

    const existingDept = await db.department.findUnique({ where: { id } });
    if (!existingDept) {
      return NextResponse.json({ error: "Department not found." }, { status: 404 });
    }

    const updateData: Record<string, any> = {};

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        return NextResponse.json({ error: "Department name cannot be empty." }, { status: 400 });
      }
      updateData.name = cleanName;
    }

    if (code !== undefined) {
      const cleanCode = String(code).trim().toUpperCase();
      if (!cleanCode) {
        return NextResponse.json({ error: "Department code cannot be empty." }, { status: 400 });
      }
      updateData.code = cleanCode;
    }

    if (updateData.name || updateData.code) {
      const orConditions: any[] = [];
      if (updateData.code) {
        orConditions.push({ code: { equals: updateData.code, mode: "insensitive" } });
      }
      if (updateData.name) {
        orConditions.push({ name: { equals: updateData.name, mode: "insensitive" } });
      }

      const duplicate = await db.department.findFirst({
        where: {
          id: { not: id },
          OR: orConditions,
        },
      });

      if (duplicate) {
        if (updateData.code && duplicate.code.toUpperCase() === updateData.code) {
          return NextResponse.json(
            { error: `Department code '${updateData.code}' is already in use by '${duplicate.name}'.` },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: `Department name '${updateData.name}' already exists with code '${duplicate.code}'.` },
          { status: 409 }
        );
      }
    }

    if (description !== undefined) {
      updateData.description = description ? String(description).trim() : null;
    }
    if (supervisorName !== undefined || supervisor2Name !== undefined) {
      updateData.supervisorName = formatSupervisorNames(
        supervisorName !== undefined ? (supervisorName ? String(supervisorName) : null) : existingDept.supervisorName,
        supervisor2Name !== undefined ? (supervisor2Name ? String(supervisor2Name) : null) : null
      );
    }
    if (supervisorEmail !== undefined || supervisor2Email !== undefined) {
      const mergedEmails = formatSupervisorEmails(
        supervisorEmail !== undefined ? (supervisorEmail ? String(supervisorEmail) : null) : existingDept.supervisorEmail,
        supervisor2Email !== undefined ? (supervisor2Email ? String(supervisor2Email) : null) : null
      );
      if (mergedEmails && !isValidSupervisorEmailList(mergedEmails)) {
        return NextResponse.json(
          { error: "One or more supervisor email addresses are invalid." },
          { status: 400 }
        );
      }
      updateData.supervisorEmail = mergedEmails;
    }

    const updated = await db.department.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { employees: true, phoneAssets: true },
        },
      },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "UPDATE_DEPARTMENT",
      entityType: "DEPARTMENT",
      entityId: updated.id,
      changes: updateData,
    });

    return NextResponse.json({ success: true, department: updated });
  } catch (error: any) {
    console.error("Update department error:", error);
    return NextResponse.json({ error: error.message || "Failed to update department." }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db.employee.updateMany({
      where: { departmentId: { not: null } },
      data: { departmentId: null },
    });
    await db.phoneAsset.updateMany({
      where: { departmentId: { not: null } },
      data: { departmentId: null },
    });
    await db.user.updateMany({
      where: { departmentId: { not: null } },
      data: { departmentId: null },
    });

    const deleted = await db.department.deleteMany({});

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "DELETE_ALL_DEPARTMENTS",
      entityType: "DEPARTMENT",
      entityId: "ALL",
      changes: { removedCount: deleted.count },
    });

    return NextResponse.json({
      success: true,
      removedCount: deleted.count,
      message: `Removed all ${deleted.count} department(s). Ready for import.`,
    });
  } catch (error: any) {
    console.error("Delete all departments error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to remove all departments." },
      { status: 500 }
    );
  }
}
