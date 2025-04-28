document.addEventListener('DOMContentLoaded', function () {
    // --- DOM Element References ---
    const proteinSelect = document.getElementById('protein-select');
    const viewportDiv = document.getElementById('viewport');
    const infoContentDiv = document.getElementById('info-content');
    const coloringControlsDiv = document.getElementById('coloring-controls');

    // --- Global NGL Variables ---
    let stage = null;
    let currentRepresentation = null;
    let currentComponent = null;
    let currentProteinData = null; // Store data about the currently loaded protein

    // --- Default Coloring Options for RCSB --- (Can be customized)
    const defaultRcsbColoringOptions = [
      { name: "By Chain", schemeId: "chainid" },
      { name: "By Residue Index", schemeId: "residueindex" },
      { name: "By B-Factor", schemeId: "bfactor" },
      { name: "Uniform Gray", schemeId: "uniform", params: { value: "gray" } }
    ];

    // --- Helper Functions ---
    function formatKey(key) {
        // Simple helper to format JSON keys for display
        return key.replace(/([A-Z])/g, ' $1') // Add space before caps
                  .replace(/^./, str => str.toUpperCase()); // Capitalize first letter
    }

    // --- Core Functions ---

    /**
     * Initializes the NGL stage.
     */
    function initNGL() {
        console.log("Initializing NGL Stage...");
        try {
            stage = new NGL.Stage(viewportDiv);
            stage.setParameters({ backgroundColor: "white" });

            // Handle window resizing
            window.addEventListener('resize', function () {
                if (stage) {
                    stage.handleResize();
                }
            }, false);
            console.log("NGL Stage initialized.");
        } catch (error) {
            console.error("Failed to initialize NGL Stage:", error);
            viewportDiv.innerHTML = '<p style="color: red; padding: 20px;">Error initializing NGL Viewer. See console for details.</p>';
        }
    }

    /**
     * Fetches the protein index and populates the selector dropdown.
     */
    async function populateProteinSelector() {
        console.log("Populating protein selector...");
        try {
            const response = await fetch('data/index.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const proteins = await response.json();

            proteinSelect.innerHTML = ''; // Clear "Loading..."
            // Add a default placeholder option
            const placeholderOption = document.createElement('option');
            placeholderOption.value = "";
            placeholderOption.textContent = "-- Select a Protein --";
            placeholderOption.disabled = true;
            placeholderOption.selected = true;
            proteinSelect.appendChild(placeholderOption);

            proteins.forEach(protein => {
                const option = document.createElement('option');
                // Store the whole protein object as JSON string in the value for easier access later
                option.value = JSON.stringify(protein); 
                option.textContent = protein.name;
                proteinSelect.appendChild(option);
            });

            // Add the event listener *after* populating
            proteinSelect.onchange = (event) => {
                if (event.target.value) {
                    try {
                        const selectedProteinData = JSON.parse(event.target.value);
                        loadProtein(selectedProteinData)
                            .catch(error => {
                                console.error("Error during protein load process:", error);
                                infoContentDiv.innerHTML = `<p style="color:red;">Failed to load protein. Check console.</p>`;
                                coloringControlsDiv.innerHTML = '';
                            });
                    } catch (parseError) {
                        console.error("Error parsing protein data from selector:", parseError);
                        infoContentDiv.innerHTML = `<p style="color:red;">Internal error selecting protein.</p>`;
                        coloringControlsDiv.innerHTML = '';
                    }
                }
            };
            console.log("Protein selector populated.");

        } catch (error) {
            console.error("Error fetching or processing protein index:", error);
            proteinSelect.innerHTML = '<option value="">Error loading list</option>';
            infoContentDiv.innerHTML = `<p style="color:red;">Could not load protein list: ${error.message}</p>`;
        }
    }

    /**
     * Loads the selected protein's data (info, structure, coloring).
     * @param {object} proteinData - The protein object from index.json {name, path, pdbId}.
     */
    async function loadProtein(proteinData) {
        console.log(`Loading protein: ${proteinData.name}`, proteinData);
        currentProteinData = proteinData; // Store current protein info

        // Clear previous state
        stage?.removeAllComponents();
        currentComponent = null;
        currentRepresentation = null;
        infoContentDiv.innerHTML = '<p>Loading details...</p>';
        coloringControlsDiv.innerHTML = '<h3>Coloring</h3><p>Loading options...</p>';

        let infoData = { name: proteinData.name }; // Default info
        let coloringOptions = defaultRcsbColoringOptions; // Default options
        let structureSource = null;

        if (proteinData.pdbId) {
            // --- Load from RCSB ---
            console.log(`Preparing to load PDB ID: ${proteinData.pdbId} from RCSB.`);
            structureSource = `rcsb://${proteinData.pdbId}`;
            // You could potentially fetch more details from RCSB PDB API here if needed
            infoData.source = "RCSB PDB";
            infoData.pdbId = proteinData.pdbId;
            // Use default coloring options for RCSB entries, including bfactor
            coloringOptions = defaultRcsbColoringOptions;

        } else if (proteinData.path) {
            // --- Load from Local Files ---
            console.log(`Preparing to load local path: ${proteinData.path}`);
            const basePath = `data/${proteinData.path}`;
            const infoUrl = `${basePath}/info.json`;
            const coloringUrl = `${basePath}/coloring_options.json`;
            structureSource = `${basePath}/structure.pdb`;

            try {
                // Fetch local metadata and coloring options concurrently
                const [infoResponse, coloringResponse] = await Promise.all([
                    fetch(infoUrl),
                    fetch(coloringUrl)
                ]);

                if (!infoResponse.ok) throw new Error(`Failed to load info.json: ${infoResponse.statusText}`);
                if (!coloringResponse.ok) throw new Error(`Failed to load coloring_options.json: ${coloringResponse.statusText}`);

                infoData = await infoResponse.json();
                coloringOptions = await coloringResponse.json();

            } catch (error) {
                console.error(`Error loading local data files for ${proteinData.path}:`, error);
                infoContentDiv.innerHTML = `<p style="color: red;">Error loading local data: ${error.message}. Check console.</p>`;
                coloringControlsDiv.innerHTML = '';
                stage?.removeAllComponents();
                return; // Stop loading if local files fail
            }
        } else {
             console.error("Invalid protein data:", proteinData);
             infoContentDiv.innerHTML = '<p style="color:red;">Invalid protein entry selected.</p>';
             return;
        }

        // --- Update UI and Load Structure ---
        try {
            displayInfo(infoData);
            setupColoringControls(coloringOptions);
            await loadStructure(structureSource, coloringOptions); // Load from determined source
            console.log(`Protein ${proteinData.name} loaded successfully.`);
        } catch (loadError) {
             console.error(`Failed during structure load or UI update for ${proteinData.name}:`, loadError);
             // Error message is likely already set by loadStructure
             if (!infoContentDiv.innerHTML.includes('Failed to load')) {
                 infoContentDiv.innerHTML = `<p style="color: red;">Failed to display protein ${proteinData.name}. Check console.</p>`;
             }
             coloringControlsDiv.innerHTML = ''; // Clear controls on error
             stage?.removeAllComponents(); // Ensure stage is clear on error
        }
    }

    /**
     * Displays protein metadata in the info panel.
     * @param {object} data - The parsed info.json data.
     */
    function displayInfo(data) {
        console.log("Displaying protein info:", data);
        let html = '<h3>Details</h3><ul>';
        if (data && typeof data === 'object') {
             for (const key in data) {
                if (Object.hasOwnProperty.call(data, key)) {
                    html += `<li><strong>${formatKey(key)}:</strong> ${data[key]}</li>`;
                }
            }
        } else {
            html += '<li>No details available.</li>';
        }
        html += '</ul>';
        infoContentDiv.innerHTML = html;
    }

    /**
     * Creates buttons for available coloring schemes.
     * @param {Array<object>} options - Array of coloring options from coloring_options.json.
     */
    function setupColoringControls(options) {
        console.log("Setting up coloring controls:", options);
        coloringControlsDiv.innerHTML = '<h3>Coloring</h3>'; // Clear loading message and add header

        if (!Array.isArray(options) || options.length === 0) {
            coloringControlsDiv.innerHTML += '<p>No coloring options defined.</p>';
            return;
        }

        options.forEach(option => {
            if (!option.name || !option.schemeId) {
                console.warn("Skipping invalid coloring option:", option);
                return;
            }
            const button = document.createElement('button');
            button.textContent = option.name;
            button.dataset.schemeId = option.schemeId;
            // Store optional parameters if they exist
            if (option.params) {
                button.dataset.schemeParams = JSON.stringify(option.params);
            }
            button.onclick = () => {
                applyColoring(option.schemeId, option.params);
            };
            coloringControlsDiv.appendChild(button);
        });
    }

    /**
     * Loads the structure file (local or RCSB) into the NGL stage.
     * @param {string} structureSource - The URL (local path or rcsb://...) to the structure file.
     * @param {Array<object>} coloringOptions - Available coloring options to apply the first one.
     */
    async function loadStructure(structureSource, coloringOptions) {
        if (!stage) {
            console.error("NGL Stage not initialized, cannot load structure.");
            throw new Error("NGL Stage not ready.");
        }
        console.log(`NGL: Loading structure from source: ${structureSource}`);
        try {
            const component = await stage.loadFile(structureSource, { defaultRepresentation: false });
            currentComponent = component;
            console.log("NGL: Structure file loaded, component:", component);

            let initialColorParam = "gray"; // Default to uniform gray directly

            if (coloringOptions && coloringOptions.length > 0) {
                const firstOption = coloringOptions[0];
                console.log("Using initial coloring scheme:", firstOption.name);

                // --- Determine the correct color parameter format ---
                if (firstOption.schemeId === "uniform" && firstOption.params?.value) {
                    initialColorParam = firstOption.params.value; // e.g., "gray", "#FF0000"
                } else if (firstOption.params && Object.keys(firstOption.params).length > 0) {
                    // For schemes with parameters (like bfactor often needs a domain)
                    initialColorParam = { scheme: firstOption.schemeId, ...firstOption.params };
                    // Note: For bfactor, dynamic domain calculation might be needed if not provided
                    // Consider adding logic here if required based on component data
                } else {
                    // For simple schemes without parameters (chainid, residueindex, etc.)
                    initialColorParam = firstOption.schemeId;
                }
                 console.log("Calculated initial color parameter:", initialColorParam);
            } else {
                console.warn("No coloring options provided, defaulting to uniform gray.");
            }

            const representationParams = { color: initialColorParam }; // Pass the correctly formatted param
            console.log("Adding initial 'cartoon' representation with params:", representationParams);
            currentRepresentation = component.addRepresentation("cartoon", representationParams);
            console.log("NGL: Initial representation added:", currentRepresentation.uuid);

            component.autoView();
            console.log("NGL: View automatically adjusted.");

        } catch (error) {
            console.error(`NGL Error loading or processing structure from ${structureSource}:`, error);
            viewportDiv.innerHTML = `<p style="color: red; text-align: center; padding-top: 50px;">Failed to load 3D structure from ${structureSource}. ${error.message || 'Unknown error'}</p>`;
            throw error; // Re-throw so loadProtein can catch it
        }
    }

    /**
     * Applies a specific coloring scheme to the current representation.
     * @param {string} schemeId - The NGL scheme ID (e.g., "chainid", "residueindex").
     * @param {object} [schemeParams] - Optional parameters for the color scheme.
     */
    function applyColoring(schemeId, schemeParams = {}) {
        console.log(`Applying coloring: schemeId=${schemeId}, params=`, schemeParams);
        if (!currentComponent || !stage) {
            console.warn("Cannot apply coloring: Component or stage not ready.");
            return;
        }

        // --- Determine the correct color parameter format ---
        let colorParam;
        if (schemeId === "uniform" && schemeParams?.value) {
            colorParam = schemeParams.value; // e.g., "gray", "#FF0000"
        } else if (schemeParams && Object.keys(schemeParams).length > 0) {
            // Schemes with parameters
            colorParam = { scheme: schemeId, ...schemeParams };
            // Note: Add dynamic domain calculation for bfactor here if needed,
            // potentially using currentComponent.structure.atomStore.bfactor
        } else {
            // Simple schemes
            colorParam = schemeId;
        }
        console.log("Calculated color parameter for application:", colorParam);

        // --- Recreate Representation --- 
        if (currentRepresentation) {
            try {
                console.log("Removing old representation:", currentRepresentation.uuid);
                currentComponent.removeRepresentation(currentRepresentation);
            } catch (removeError) {
                console.error("Error removing previous representation:", removeError);
                // Continue, try adding the new one anyway
            }
        }

        try {
            const representationParams = { color: colorParam }; // Use the correctly formatted param
            console.log("Adding new 'cartoon' representation with params:", representationParams);
            currentRepresentation = currentComponent.addRepresentation("cartoon", representationParams);
            console.log("New representation added:", currentRepresentation.uuid);
        } catch (addError) {
             console.error(`Error adding representation with scheme ${schemeId}:`, addError);
             // Attempt to restore a default view or show an error
             try {
                 currentRepresentation = currentComponent.addRepresentation("cartoon", { color: "grey" });
                 alert(`Failed to apply color scheme '${schemeId}'. Resetting to default grey cartoon. See console for details.`);
             } catch (fallbackError) {
                 console.error("Error adding fallback representation:", fallbackError);
                 alert(`Failed to apply color scheme '${schemeId}' and could not restore view. See console.`);
             }
        }
    }

    // --- Initial Setup ---
    if (typeof NGL !== 'undefined') {
        initNGL();
        populateProteinSelector();
    } else {
        console.error("NGL library not loaded!");
         viewportDiv.innerHTML = '<p style="color: red; padding: 20px;">Error: NGL library failed to load. Check the script tag in index.html and network connection.</p>';
         // Disable controls if NGL fails to load
         proteinSelect.disabled = true;
    }

}); 