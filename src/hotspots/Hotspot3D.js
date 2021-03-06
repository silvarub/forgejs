/**
 * FORGE.Hotspot3D
 * Abstract base class for projeted views. Should be subclassed for every supported projection / view type.
 *
 * @constructor FORGE.Hotspot3D
 * @param {FORGE.Viewer} viewer - viewer reference
 * @param {HotspotConfig} config - hostspot configuration
 * @extends {FORGE.Object3D}
 *
 * @todo Review/refactor all the raycasting and click part
 */
FORGE.Hotspot3D = function(viewer, config)
{
    /**
     * Hotspot configuration
     * @name  FORGE.Hotspot3D#_config
     * @type {HotspotConfig}
     * @private
     */
    this._config = config;

    /**
     * Name
     * @name  FORGE.Hotspot3D#_name
     * @type {string}
     * @private
     */
    this._name = "";

    /**
     * HotspotTransform object for the 3D object.
     * @name  FORGE.Hotspot3D#_transform
     * @type {FORGE.HotspotTransform}
     * @private
     */
    this._transform = null;

    /**
     * Material object for the 3D object.
     * @name  FORGE.Hotspot3D#_material
     * @type {FORGE.HotspotMaterial}
     * @private
     */
    this._material = null;

    /**
     * Color based on 3D Object id used for picking.
     * @name FORGE.Hotspot3D#_pickingColor
     * @type {THREE.Color}
     * @private
     */
    this._pickingColor = null;

    /**
     * Sound object for the 3D object.
     * @name  FORGE.Hotspot3D#_sound
     * @type {FORGE.HotspotSound}
     * @private
     */
    this._sound = null;

    /**
     * Animation object for the 3D object.
     * @name FORGE.Hotspot3D#_animation
     * @type {FORGE.HotspotAnimation}
     * @private
     */
    this._animation = null;

    /**
     * Does the hotspot is facing the camera ? Useful for a flat hotspot we want
     * to always be facing to the camera.
     * @type {boolean}
     * @private
     */
    this._facingCenter = false;

    /**
     * Before render bound callback.
     * @name FORGE.Hotspot3D#_onBeforeRenderBound
     * @type {?function(this:THREE.Object3D,?THREE.WebGLRenderer,?THREE.Scene,?THREE.Camera,?THREE.Geometry,?THREE.Material,?THREE.Group)}
     * @private
     */
    this._onBeforeRenderBound = null;

    /**
     * After render bound callback.
     * @name FORGE.Hotspot3D#_onAfterRenderBound
     * @type {?function(this:THREE.Object3D,?THREE.WebGLRenderer,?THREE.Scene,?THREE.Camera,?THREE.Geometry,?THREE.Material,?THREE.Group)}
     * @private
     */
    this._onAfterRenderBound = null;

    FORGE.Object3D.call(this, viewer, "Hotspot3D");
};

FORGE.Hotspot3D.prototype = Object.create(FORGE.Object3D.prototype);
FORGE.Hotspot3D.prototype.constructor = FORGE.Hotspot3D;

/**
 * Boot sequence.<br>
 * Call superclass boot when objects are created as it will trigger parse config
 * @private
 */
FORGE.Hotspot3D.prototype._boot = function()
{
    FORGE.Object3D.prototype._boot.call(this);

    this._transform = new FORGE.HotspotTransform();
    this._animation = new FORGE.HotspotAnimation(this._viewer, this._transform);
    this._material = new FORGE.HotspotMaterial(this._viewer);

    this._onBeforeRenderBound = this._onBeforeRender.bind(this);
    this._onAfterRenderBound = this._onAfterRender.bind(this);

    if (typeof this._config !== "undefined" && this._config !== null)
    {
        this._parseConfig(this._config);
    }
};

/**
 * Parse the config object.
 * @method FORGE.Hotspot3D#_parseConfig
 * @param {HotspotConfig} config - The hotspot config to parse.
 * @private
 */
FORGE.Hotspot3D.prototype._parseConfig = function(config)
{
    this._uid = config.uid;
    this._tags = config.tags;
    this._register();

    this._type = config.type;
    this._name = config.name;
    this._visible = config.visible;

    this._mesh.name = "mesh-" + this._uid;

    this._facingCenter = config.facingCenter || false;

    if (typeof config.transform !== "undefined")
    {
        this._transform.load(config.transform);
    }

    if (typeof config.animation !== "undefined")
    {
        this._animation.load(config.animation);
        this._animation.onProgress.add(this._updatePosition, this);
    }

    this._material.onReady.add(this._materialReadyHandler, this);

    /** @type {HotspotMaterialConfig} */
    var materialConfig;

    if (typeof config.material !== "undefined")
    {
        materialConfig = config.material;
    }
    else
    {
        materialConfig = FORGE.HotspotMaterial.presets.TRANSPARENT;
    }

    if (this._debug === true)
    {
        materialConfig = /** @type {HotspotMaterialConfig} */ (FORGE.Utils.extendMultipleObjects(materialConfig, FORGE.HotspotMaterial.presets.DEBUG));
    }

    this._material.load(materialConfig);

    if (typeof config.sound !== "undefined")
    {
        this._sound = new FORGE.HotspotSound(this._viewer);
        this._sound.load(config.sound, config.transform);
    }

    if (typeof config.fx === "string")
    {
        this._fx = config.fx;
    }

    if (typeof config.events === "object")
    {
        this._createEvents(config.events);
    }
};

/**
 * Before render handler
 * @method FORGE.Hotspot3D#_onBeforeRender
 * @private
 */
FORGE.Hotspot3D.prototype._onBeforeRender = function(renderer, scene, camera, geometry, material, group)
{
    //Logs these value for jscs check (if not warn parameter is not used)
    this.log(group);

    var gl = this._viewer.renderer.webGLRenderer.getContext();

    this._viewer.renderer.view.updateUniforms(material.uniforms);

    // Check what is the current render pass looking at the material: Hotspot or Picking Material
    if (material.name === "HotspotMaterial")
    {
        if (this._material.type === FORGE.HotspotMaterial.types.GRAPHICS)
        {
            material.uniforms.tColor.value = new THREE.Color(this._material.color);
        }
        else
        {
            material.uniforms.tTexture.value = this._material._texture;
        }
    }
    else if (material.name === "PickingMaterial")
    {
        // As picking material is the same for all spots renderer in this pass, material uniforms won't be refreshed
        // Setting material.uniforms.tColor value will be useless, set direct value by acceding program uniforms map
        // Call useProgram first to avoid WebGL warning if material.program is not the current program
        // Set also material uniform to avoid both settings will collide on first object
        if (material.program)
        {
            var color = this._pickingColor;
            gl.useProgram(material.program.program);
            material.program.getUniforms().map.tColor.setValue(gl, color);
            material.uniforms.tColor.value = color;
        }
    }
};

/**
 * After render handler
 * @method FORGE.Hotspot3D#_onAfterRender
 * @private
 */
FORGE.Hotspot3D.prototype._onAfterRender = function()
{};

/**
 * Event handler for material ready. Triggers the creation of the hotspot3D.
 * @method FORGE.Hotspot3D#_materialReadyHandler
 * @private
 */
FORGE.Hotspot3D.prototype._materialReadyHandler = function()
{
    this._mesh.material = this._material.material;

    this._createHotspot3D();

    this._pickingColor = FORGE.PickingDrawPass.colorFrom3DObject(this._mesh);

    this._mesh.onBeforeRender = /** @type {function(this:THREE.Object3D,?THREE.WebGLRenderer,?THREE.Scene,?THREE.Camera,?THREE.Geometry,?THREE.Material,?THREE.Group)} */ (this._onBeforeRenderBound);
    this._mesh.onAfterRender = /** @type {function(this:THREE.Object3D,?THREE.WebGLRenderer,?THREE.Scene,?THREE.Camera,?THREE.Geometry,?THREE.Material,?THREE.Group)} */ (this._onAfterRenderBound);

    if (this._animation.autoPlay === true)
    {
        this._animation.play();
    }
};

/**
 * Final init step once setup is done.
 * @method FORGE.Hotspot3D#_setupDoneCallback
 * @private
 */
FORGE.Hotspot3D.prototype._createHotspot3D = function()
{
    if (typeof this._config.geometry !== "undefined" && typeof this._config.geometry.type === "string")
    {
        var options = this._config.geometry.options;

        switch (this._config.geometry.type)
        {
            case FORGE.HotspotGeometryType.BOX:
                this._mesh.geometry = FORGE.HotspotGeometry.BOX(options);
                break;
            case FORGE.HotspotGeometryType.SPHERE:
                this._mesh.geometry = FORGE.HotspotGeometry.SPHERE(options);
                break;
            case FORGE.HotspotGeometryType.CYLINDER:
                this._mesh.geometry = FORGE.HotspotGeometry.CYLINDER(options);
                break;
            case FORGE.HotspotGeometryType.PLANE:
                this._mesh.geometry = FORGE.HotspotGeometry.PLANE(options);
                break;
            default:
                this._mesh.geometry = FORGE.HotspotGeometry.PLANE();
                break;
        }
    }
    else
    {
        this._mesh.geometry = FORGE.HotspotGeometry.PLANE();
    }

    this._mesh.geometry.scale(this._transform.scale.x, this._transform.scale.y, this._transform.scale.z);
    this._mesh.material = this._material.material;
    this._mesh.userData = this._config;

    // Only enable frustum culling when view is rectilinear and frustum makes sense
    this._mesh.frustumCulled = this._viewer.renderer.view instanceof FORGE.ViewRectilinear;

    this._updatePosition();

    this._ready = true;

    if (this._onReady !== null)
    {
        this._onReady.dispatch();
    }
};

/**
 * Setup hotspot spatial position.
 * @method FORGE.Hotspot3D#_setupPosition
 * @private
 */
FORGE.Hotspot3D.prototype._updatePosition = function()
{
    this._mesh.position.x = this._transform.position.x;
    this._mesh.position.y = this._transform.position.y;
    this._mesh.position.z = this._transform.position.z;

    if (this._facingCenter === true)
    {
        var spherical = new THREE.Spherical().setFromVector3(new THREE.Vector3(this._transform.position.x, this._transform.position.y, this._transform.position.z));

        this._mesh.rotation.set(-spherical.phi + Math.PI / 2, spherical.theta + Math.PI, 0, "YXZ");

        // Apply rotation
        this._mesh.rotation.x += -FORGE.Math.degToRad(this._transform.rotation.x); // pitch
        this._mesh.rotation.y += FORGE.Math.degToRad(this._transform.rotation.y); // yaw
        this._mesh.rotation.z += FORGE.Math.degToRad(this._transform.rotation.z);
    }
    else
    {
        // Apply rotation
        var rx = -FORGE.Math.degToRad(this._transform.rotation.x); // pitch
        var ry = FORGE.Math.degToRad(this._transform.rotation.y); // yaw
        var rz = FORGE.Math.degToRad(this._transform.rotation.z);

        this._mesh.rotation.set(rx, ry, rz, "YXZ");
    }

    // Scale
    this._mesh.scale.x = FORGE.Math.clamp(this._transform.scale.x, 0.000001, 100000);
    this._mesh.scale.y = FORGE.Math.clamp(this._transform.scale.y, 0.000001, 100000);
    this._mesh.scale.z = FORGE.Math.clamp(this._transform.scale.z, 0.000001, 100000);
};

/**
 * Update hotspot content
 * @method FORGE.Hotspot3D#update
 */
FORGE.Hotspot3D.prototype.update = function()
{
    if (this._material !== null)
    {
        this._material.update();
    }

    if (this._sound !== null)
    {
        this._sound.update();
    }
};

/**
 * Destroy routine
 * @method FORGE.Hotspot3D#destroy
 */
FORGE.Hotspot3D.prototype.destroy = function()
{
    this._material.onReady.remove(this._materialReadyHandler, this);

    this._onBeforeRenderBound = null;
    this._onAfterRenderBound = null;

    if (this._transform !== null)
    {
        this._transform.destroy();
        this._transform = null;
    }

    if (this._animation !== null)
    {
        this._animation.destroy();
        this._animation = null;
    }

    if (this._material !== null)
    {
        this._material.destroy();
        this._material = null;
    }

    if (this._sound !== null)
    {
        this._sound.destroy();
        this._sound = null;
    }

    FORGE.Object3D.prototype.destroy.call(this);
};

/**
 * Hotspot type accessor
 * @name FORGE.Hotspot3D#visible
 * @readonly
 * @type {string}
 */
Object.defineProperty(FORGE.Hotspot3D.prototype, "type",
{
    /** @this {FORGE.Hotspot3D} */
    get: function()
    {
        return this._type;
    }
});

/**
 * Hotspot name accessor
 * @name FORGE.Hotspot3D#name
 * @readonly
 * @type {string}
 */
Object.defineProperty(FORGE.Hotspot3D.prototype, "name",
{
    /** @this {FORGE.Hotspot3D} */
    get: function()
    {
        return this._name;
    }
});

/**
 * Hotspot animation accessor
 * @name FORGE.Hotspot3D#animation
 * @readonly
 * @type {FORGE.HotspotAnimation}
 */
Object.defineProperty(FORGE.Hotspot3D.prototype, "animation",
{
    /** @this {FORGE.Hotspot3D} */
    get: function()
    {
        return this._animation;
    }
});