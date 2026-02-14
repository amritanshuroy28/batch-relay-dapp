import hre from "hardhat";

async function main() {
    console.log("HRE object keys:", Object.keys(hre));
    console.log("Has ethers?", "ethers" in hre);
    console.log("ethers value:", hre.ethers);
    
    if (hre.ethers) {
        console.log("Ethers available!");
        const signers = await hre.ethers.getSigners();
        console.log("Signers:", signers.map(s => s.address));
    } else {
        console.log("Ethers NOT available!");
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
