"""Render the lightweight organization-network loop used by the HQ wizard."""

from math import cos, pi, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/hq/public/onboarding/organization-network-loop.webm"
FRAMES = ROOT / ".tmp/onboarding-motion/frame-"
COLORS = (
    (0.16, 0.31, 0.28, 1),
    (0.54, 0.42, 0.30, 1),
    (0.35, 0.45, 0.52, 1),
    (0.54, 0.51, 0.43, 1),
    (0.30, 0.36, 0.34, 1),
)


def material(name: str, color: tuple[float, float, float, float]):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = 0.58
    return value


def rounded_node(index: int, angle: float):
    radius = 2.35
    x, y = radius * cos(angle), radius * sin(angle)
    bpy.ops.mesh.primitive_cube_add(location=(x, y, 0))
    node = bpy.context.object
    node.name = f"App {index + 1}"
    node.scale = (0.62, 0.62, 0.28)
    node.data.materials.append(material(f"App material {index + 1}", COLORS[index]))
    bevel = node.modifiers.new("Soft corners", "BEVEL")
    bevel.width, bevel.segments = 0.22, 5
    bpy.context.view_layer.objects.active = node
    bpy.ops.object.shade_smooth()
    node.keyframe_insert("location", frame=1)
    node.location.z = 0.18 + (index % 2) * 0.08
    node.keyframe_insert("location", frame=25)
    node.location.z = 0
    node.keyframe_insert("location", frame=49)
    return node


def connector(end: tuple[float, float, float], index: int):
    curve = bpy.data.curves.new(f"Connector {index + 1}", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth, curve.bevel_resolution = 0.035, 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(1)
    for point, coordinate in zip(spline.bezier_points, ((0, 0, -0.04), end)):
        point.co = coordinate
        point.handle_left_type = point.handle_right_type = "AUTO"
    value = bpy.data.objects.new(f"Connector {index + 1}", curve)
    value.data.materials.append(material(f"Line material {index + 1}", (0.56, 0.54, 0.49, 1)))
    bpy.context.collection.objects.link(value)


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 640, 360
    scene.render.resolution_percentage = 100
    scene.render.fps, scene.frame_start, scene.frame_end = 24, 1, 49
    FRAMES.parent.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(FRAMES)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.91, 0.89, 0.84, 1)

    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.92, depth=0.5)
    hub = bpy.context.object
    hub.name = "Organization hub"
    hub.data.materials.append(material("Hub material", (0.09, 0.11, 0.12, 1)))
    hub.rotation_euler.z = 0
    hub.keyframe_insert("rotation_euler", frame=1)
    hub.rotation_euler.z = 2 * pi
    hub.keyframe_insert("rotation_euler", frame=49)

    for index in range(5):
        angle = (2 * pi * index / 5) + pi / 2
        node = rounded_node(index, angle)
        connector(tuple(node.location), index)

    bpy.ops.object.light_add(type="AREA", location=(0, 0, 7))
    bpy.context.object.data.energy, bpy.context.object.data.shape = 850, "DISK"
    bpy.context.object.data.size = 6
    bpy.ops.object.camera_add(location=(0, -0.25, 8.8), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.data.type, camera.data.ortho_scale = "ORTHO", 7.1
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera


if __name__ == "__main__":
    setup_scene()
    bpy.ops.wm.save_as_mainfile(filepath=str(FRAMES.parent / "source.blend"))
    bpy.ops.render.render(animation=True)
